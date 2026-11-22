"""Run with `python3 tests/test_replay.py` after `cargo build`. Requires ffmpeg."""

from contextlib import contextmanager
import json
import os
from pathlib import Path
import re
import struct
import subprocess
import sys
import tempfile
import time
import unittest
from urllib.request import ProxyHandler, build_opener


ROOT = Path(__file__).resolve().parents[1]
BINARY = ROOT / "target" / "debug" / ("a16t.exe" if os.name == "nt" else "a16t")
HTTP = build_opener(ProxyHandler({}))


@contextmanager
def run_receiver(archive, profile="eastbay-marine"):
    log_path = archive / "receiver.log"
    with log_path.open("w") as log:
        process = subprocess.Popen(
            [str(BINARY), "--mode", "replay", "--bind", "127.0.0.1:0",
             "--python", sys.executable, "--data-dir", str(archive),
             "--profile", str(ROOT / "profiles" / (profile + ".json"))],
            cwd=ROOT, env={**os.environ, "A16T_TRANSCRIPTION_PROVIDER": "none"},
            stdout=log, stderr=log,
        )
        try:
            deadline = time.monotonic() + 10
            while time.monotonic() < deadline and process.poll() is None:
                match = re.search(r"Watchboard (http://127\.0\.0\.1:\d+)", log_path.read_text())
                if match:
                    yield match[1]
                    return
                time.sleep(.05)
            raise AssertionError("Receiver failed to start:\n" + log_path.read_text())
        finally:
            process.terminate()
            try:
                process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait()
                raise


def fetch_state(base):
    with HTTP.open(base + "/api/state", timeout=4) as response:
        return json.load(response)


class ReplayTest(unittest.TestCase):
    def test_receiver_watchboard_and_archive(self):
        self.assertTrue(BINARY.is_file(), "Build the application first with cargo build.")
        with tempfile.TemporaryDirectory() as scratch:
            archive = Path(scratch)
            with run_receiver(archive) as base:
                first = fetch_state(base)
                self.assertEqual(first["source"], "replay")
                self.assertEqual(first["profile"], "eastbay-marine")
                channel = first["channels"][0]

                with HTTP.open(base + "/events", timeout=5) as stream:
                    fields = {}
                    self.assertEqual(stream.headers.get_content_type(), "text/event-stream")
                    for line in stream:
                        if not line.strip() and fields:
                            break
                        if b":" in line:
                            key, value = line.rstrip().split(b":", 1)
                            fields[key] = value.strip()
                    self.assertEqual(fields[b"event"], b"state")
                    self.assertEqual(json.loads(fields[b"data"])["profile"], first["profile"])

                with HTTP.open(base + "/api/listen/" + channel["id"], timeout=5) as audio:
                    self.assertEqual(audio.headers.get_content_type(), "audio/wav")
                    header = audio.read(44)
                    self.assertEqual(header[:4], b"RIFF")
                    self.assertEqual(header[8:16], b"WAVEfmt ")
                    self.assertEqual(struct.unpack_from("<HHI", header, 20), (1, 1, 16_000))
                    self.assertEqual(struct.unpack_from("<H", header, 34)[0], 16)
                    self.assertEqual(header[36:40], b"data")
                    for _ in range(80):
                        block = audio.read(2048)
                        if any(block):
                            break
                    else:
                        self.fail("The live monitor never received the replay signal.")

                deadline = time.monotonic() + 15
                while time.monotonic() < deadline:
                    state = fetch_state(base)
                    if state["receiver"] == "finished" and state["clips"] and state["clips"][0]["status"] == "ready":
                        break
                    time.sleep(.1)
                else:
                    self.fail("Replay did not archive the clip: " + repr(state))
                self.assertEqual(len(state["clips"]), 1, "The isolated click must not create a clip.")
                clip = state["clips"][0]
                self.assertEqual(clip["channel"], channel["id"])
                self.assertEqual(clip["frequency_hz"], channel["frequency_hz"])
                self.assertEqual(clip["profile"], first["profile"])
                self.assertEqual(clip["source"], "replay")
                self.assertGreater(clip["session_id"], 0)
                self.assertEqual(clip["transcription_status"], "disabled")
                self.assertEqual(state["dropped_clips"], 0)
                with HTTP.open(base + "/api/timeline", timeout=4) as response:
                    timeline = json.load(response)
                self.assertEqual(timeline["end_ms"] - timeline["start_ms"], 3_600_000)
                self.assertEqual((timeline["profile"], timeline["source"]), (first["profile"], "replay"))
                self.assertEqual(len(timeline["transmissions"]), 1)
                event = timeline["transmissions"][0]
                self.assertEqual(event["id"], clip["id"])
                self.assertEqual(event["channel"], clip["channel"])
                self.assertEqual(event["start_ms"], clip["start_ms"])
                self.assertAlmostEqual(event["end_ms"] - event["start_ms"], clip["duration_ms"], delta=1)
                self.assertEqual(event["status"], "ready")
                for row in state["channels"]:
                    self.assertIsNotNone(row["last_sample_ms"])
                    self.assertEqual(row["dropped_samples"], 0)
                clip_path = "/api/clips/" + str(clip["id"]) + "/audio"
                with HTTP.open(base + clip_path, timeout=4) as response:
                    self.assertEqual(response.headers.get_content_type(), "audio/ogg")
                    opus = response.read()
                self.assertTrue(opus.startswith(b"OggS"))
                self.assertIn(b"OpusHead", opus)
                decoded = subprocess.run(
                    ["ffmpeg", "-nostdin", "-v", "error", "-i", "pipe:0", "-f", "s16le",
                     "-ac", "1", "-ar", "16000", "pipe:1"],
                    input=opus, capture_output=True, check=True, timeout=10,
                ).stdout
                self.assertTrue(any(decoded))
                self.assertAlmostEqual(len(decoded) / 32, clip["duration_ms"], delta=2)

            with run_receiver(archive, "marine-vhf") as base:
                # The second synthetic session starts with silence. The completed clip
                # is on a channel shared by both profiles and can be played immediately.
                state = fetch_state(base)
                self.assertEqual(len(state["channels"]), 48)
                self.assertEqual(state["clips"], [clip])
                with HTTP.open(base + "/api/timeline", timeout=4) as response:
                    self.assertEqual(json.load(response)["transmissions"], [event])
                with HTTP.open(base + clip_path, timeout=4) as response:
                    self.assertEqual(response.read(), opus)

            with run_receiver(archive, "noaa-weather") as base:
                with HTTP.open(base + "/api/timeline", timeout=4) as response:
                    self.assertEqual(json.load(response)["transmissions"], [])


if __name__ == "__main__":
    unittest.main()
