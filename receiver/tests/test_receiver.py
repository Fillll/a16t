import array
import io
import math
import os
import struct
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

RECEIVER = Path(__file__).resolve().parents[1]
PROFILES = RECEIVER.parent / "profiles"
sys.path.insert(0, str(RECEIVER))
from receiver import HEADER, RATE, load_profile


def decode_frames(data):
    channels = {}
    source = io.BytesIO(data)
    while header := source.read(HEADER.size):
        magic, index, count, first = HEADER.unpack(header)
        assert magic == b"A16F"
        samples = channels.setdefault(index, array.array("h"))
        assert first == len(samples)
        assert 0 < count <= 2048
        payload = source.read(2 * count)
        assert len(payload) == 2 * count
        block = array.array("h")
        block.frombytes(payload)
        if sys.byteorder != "little":
            block.byteswap()
        samples.extend(block)
    return channels


def run_receiver(profile, *args):
    return subprocess.run([sys.executable, str(RECEIVER / "receiver.py"), "--profile",
                           str(PROFILES / f"{profile}.json"), *args],
                          capture_output=True, check=True, timeout=40).stdout


class ReceiverTests(unittest.TestCase):
    def test_all_profiles(self):
        for path in PROFILES.glob("*.json"):
            with self.subTest(path=path):
                self.assertEqual(load_profile(path)["id"], path.stem)

    def test_replay_channels_cadence_and_click(self):
        channels = decode_frames(run_receiver("eastbay-marine", "--mode", "replay", "--fast"))
        self.assertEqual(len(channels), 4)
        self.assertEqual({len(audio) for audio in channels.values()}, {int(6.5 * RATE)})
        self.assertLessEqual(max(channels[0][:RATE * 2]), 0)
        self.assertGreater(max(channels[0][RATE * 3:RATE * 4]), 9000)
        self.assertEqual(sum(x != 0 for x in channels[0][RATE * 4:]), 1)
        self.assertFalse(any(channels[1]))

    def test_invalid_iq_cli(self):
        with self.assertRaises(subprocess.CalledProcessError):
            run_receiver("noaa-weather", "--mode", "iq")

    @unittest.skipUnless(os.environ.get("A16T_TEST_GNURADIO") == "1",
                         "opt in with A16T_TEST_GNURADIO=1 and GNU Radio installed")
    def test_am_and_fm_full_iq_replay(self):
        from generate_iq import generate

        def rms(samples):
            return math.sqrt(sum(x * x for x in samples) / len(samples))

        for name in ("eastbay-marine", "oak-airband"):
            with self.subTest(profile=name), tempfile.TemporaryDirectory() as tmp:
                path = Path(tmp) / "fixture.cu8"
                profile = load_profile(PROFILES / f"{name}.json")
                generate(path, profile, profile["channels"][0]["id"])
                channels = decode_frames(run_receiver(name, "--mode", "iq", "--iq-file", str(path)))
                self.assertEqual(len(channels), len(profile["channels"]))
                for index, audio in channels.items():
                    self.assertGreater(len(audio), 5.9 * RATE)
                    self.assertLess(rms(audio[RATE:2 * RATE]), 50)
                    self.assertLess(rms(audio[5 * RATE:]), 50)
                    burst = audio[3 * RATE:int(3.5 * RATE)]
                    if index == 0:
                        self.assertGreater(rms(burst), 500)
                        # Recover the actual 640-Hz modulation, not just an energy spike.
                        sine = sum(x * math.sin(2 * math.pi * 640 * i / RATE) for i, x in enumerate(burst))
                        cosine = sum(x * math.cos(2 * math.pi * 640 * i / RATE) for i, x in enumerate(burst))
                        self.assertGreater(2 * math.hypot(sine, cosine) / len(burst), 500)
                    else:
                        self.assertLess(rms(burst), 50)

    @unittest.skipUnless(os.environ.get("A16T_TEST_GNURADIO") == "1",
                         "opt in with A16T_TEST_GNURADIO=1 and GNU Radio installed")
    def test_full_marine_profile_receives_simultaneous_fm_calls(self):
        import numpy as np
        from gnuradio import blocks, gr
        from flowgraph import run_graph
        from receiver import FrameWriter

        profile = load_profile(PROFILES / "marine-vhf.json")
        group = profile["capture_groups"][0]
        rf_rate = group["sample_rate_hz"]
        # Both carriers land on odd-numbered 25 kHz bins, on opposite sides
        # of the tuner. The other 46 channels, including their neighbors, are quiet.
        tones = {"marine-66a": 700, "marine-88": 1100}
        carriers = [(ch["frequency_hz"] - group["center_frequency_hz"], tones[ch["id"]])
                    for ch in profile["channels"] if ch["id"] in tones]
        self.assertEqual(len(carriers), 2)
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "two-calls.c64"
            with path.open("wb") as output:
                for first in range(0, 2 * rf_rate, 65536):
                    t = (first + np.arange(min(65536, 2 * rf_rate - first))) / rf_rate
                    signal = np.zeros(len(t), dtype=np.complex128)
                    for offset, tone in carriers:
                        phase = 2 * np.pi * offset * t + (2000 / tone) * np.sin(2 * np.pi * tone * t)
                        signal += 0.25 * np.exp(1j * phase)
                    signal *= (t >= 0.5) & (t < 1.5)
                    output.write(signal.astype(np.complex64).tobytes())
            # Substitute only the USB source so this runs the continuous live
            # scheduler configuration. The finite RF file sets the test's endpoint.
            source = blocks.file_source(gr.sizeof_gr_complex, str(path), False)
            args = SimpleNamespace(mode="live", gain_db=None, squelch_db=-45, duration=None)
            frames = io.BytesIO()
            with patch("flowgraph.configure_sdr", return_value=source):
                run_graph(profile, FrameWriter(frames), args)
            captured = decode_frames(frames.getvalue())

        self.assertEqual(set(captured), set(range(48)))
        self.assertEqual(len({len(audio) for audio in captured.values()}), 1)
        for index, channel in enumerate(profile["channels"]):
            with self.subTest(channel=channel["id"]):
                pcm = np.asarray(captured[index], dtype=np.float64)
                self.assertAlmostEqual(len(pcm), 2 * RATE, delta=RATE // 50)
                for quiet in (pcm[RATE // 8:RATE // 4], pcm[7 * RATE // 4:]):
                    self.assertLess(np.sqrt(np.mean(quiet ** 2)), 50)
                burst = pcm[3 * RATE // 4:5 * RATE // 4]
                if channel["id"] in tones:
                    spectrum = 2 * np.abs(np.fft.rfft(burst)) / len(burst)
                    peak = int(np.argmax(spectrum))
                    self.assertGreater(spectrum[peak], 500)
                    self.assertAlmostEqual(peak * RATE / len(burst), tones[channel["id"]], delta=2)
                else:
                    self.assertLess(np.sqrt(np.mean(burst ** 2)), 50)


if __name__ == "__main__":
    unittest.main()
