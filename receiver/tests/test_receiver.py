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


if __name__ == "__main__":
    unittest.main()
