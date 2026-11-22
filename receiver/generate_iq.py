#!/usr/bin/env python3
"""Generate a local raw IQ test file with a tone on one profile channel."""

import argparse
from pathlib import Path

from receiver import load_profile


def generate(path, profile, channel_id):
    import numpy as np

    group = profile["capture_groups"][0]
    channel = next((c for c in profile["channels"] if c["id"] == channel_id), None)
    if channel is None:
        raise ValueError(f"unknown channel {channel_id}")
    rate = group["sample_rate_hz"]
    offset = channel["frequency_hz"] - group["center_frequency_hz"]
    # A controllable passband signal. The half-step ADC center is rounded with a
    # fixed seeded noise floor so silent input has no permanent DC offset.
    rng = np.random.default_rng(13)
    with path.open("xb") as dst:
        for first in range(0, 6 * rate, 65_536):
            t = (first + np.arange(min(65_536, 6 * rate - first))) / rate
            active = (t >= 2.5) & (t < 3.9)
            carrier = 2 * np.pi * offset * t
            tone = 2 * np.pi * 640 * t
            if channel["modulation"] == "am":
                envelope = 0.45 * (1 + 0.55 * np.sin(tone))
            else:
                envelope = 0.5
                carrier += (2_000 / 640) * np.sin(tone)
            signal = active * envelope * np.exp(1j * carrier)
            values = np.column_stack((signal.real, signal.imag))
            iq = 127.5 + 127 * values + rng.normal(0, 0.4, values.shape)
            dst.write(np.rint(np.clip(iq, 0, 255)).astype("u1").tobytes())


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--profile", required=True, type=Path)
    parser.add_argument("--channel", help="target channel id; defaults to the first")
    parser.add_argument("output", type=Path, help="new unsigned interleaved 8-bit IQ file")
    args = parser.parse_args()
    try:
        profile = load_profile(args.profile)
        generate(args.output, profile, args.channel or profile["channels"][0]["id"])
    except (OSError, ValueError, KeyError) as exc:
        parser.exit(1, f"fixture: {exc}\n")


if __name__ == "__main__":
    main()
