#!/usr/bin/env python3
"""A16T receive-only adapter. Standard output carries indexed PCM frames."""

import argparse
import array
import json
import math
import os
from pathlib import Path
import signal
import struct
import sys
import threading
import time

RATE = 16_000
HEADER = struct.Struct("<4sHIQ")
MAX_FRAME = 2048


def load_profile(path):
    with Path(path).open(encoding="utf-8") as source:
        profile = json.load(source)
    groups = profile["capture_groups"]
    channels = profile["channels"]
    if len(groups) != 1 or not 1 <= len(channels) <= 65535:
        raise ValueError("select a profile with one tuning window and at least one channel")
    group = groups[0]
    rate = group["sample_rate_hz"]
    if group.get("audio_rate_hz", RATE) != RATE:
        raise ValueError("audio_rate_hz must be 16000")
    channel_rate = group.get("channel_rate_hz", 240_000)
    if channel_rate <= 0 or rate <= 0 or rate % channel_rate or channel_rate % RATE:
        raise ValueError("sample rates must permit integer RF and audio decimation")
    if group.get("bias_tee", False):
        raise ValueError("the receiver requires bias tee off")
    ids = [channel["id"] for channel in channels]
    if len(set(ids)) != len(ids):
        raise ValueError("channel IDs must be unique")
    for channel in channels:
        if channel["capture_group_id"] != group["id"] or channel["modulation"] not in ("am", "nfm"):
            raise ValueError(f"unsupported receiver configuration for {channel['id']}")
        if abs(channel["frequency_hz"] - group["center_frequency_hz"]) + 15_000 > rate / 2:
            raise ValueError(f"channel {channel['id']} exceeds the receiver tuning window")
    return profile


class FrameWriter:
    def __init__(self, stream):
        self.stream = stream
        self.lock = threading.Lock()
        self.positions = {}

    def write(self, index, pcm):
        size = len(pcm) // 2
        if len(pcm) % 2:
            raise ValueError("PCM ends midway through a sample")
        with self.lock:
            first = self.positions.get(index, 0)
            for start in range(0, size, MAX_FRAME):
                n = min(size - start, MAX_FRAME)
                self.stream.write(HEADER.pack(b"A16F", index, n, first + start))
                self.stream.write(pcm[start * 2:(start + n) * 2])
            self.stream.flush()
            self.positions[index] = first + size


def emit_replay(profile, writer, fast):
    # Standard library only. All channels advance on the same sample clock.
    block = 320
    silence = bytes(block * 2)
    started = time.monotonic()
    for step in range(325):
        first = step * block
        if 125 <= step < 195:
            tone = array.array("h", (int(10000 * math.sin(2 * math.pi * 640 * i / RATE))
                                     for i in range(first, first + block)))
            if sys.byteorder != "little":
                tone.byteswap()
            audio = tone.tobytes()
        elif step == 240:
            audio = struct.pack("<h", 29000) + silence[2:]
        else:
            audio = silence
        for index in range(len(profile["channels"])):
            writer.write(index, audio if index == 0 else silence)
        if not fast:
            time.sleep(max(0, started + (step + 1) * block / RATE - time.monotonic()))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--mode", required=True, choices=["replay", "live", "iq"])
    parser.add_argument("--profile", required=True, type=Path)
    parser.add_argument("--iq-file", type=Path, help="unsigned interleaved 8-bit IQ at the profile RF rate")
    parser.add_argument("--fast", action="store_true", help="run synthetic audio replay without pacing")
    parser.add_argument("--duration", type=float, help="limit live input to this many seconds of samples")
    parser.add_argument("--gain-db", type=float, help="override live tuner gain in dB")
    parser.add_argument("--squelch-db", type=float, default=-52, help="per-channel RF squelch in dBFS (default -52)")
    args = parser.parse_args()
    if (args.mode == "iq") != (args.iq_file is not None):
        parser.error("--iq-file is required only in iq mode")
    if args.duration is not None and (args.mode != "live" or not math.isfinite(args.duration) or args.duration <= 0):
        parser.error("--duration requires live mode and a positive finite duration")
    if not math.isfinite(args.squelch_db) or (args.gain_db is not None and not math.isfinite(args.gain_db)):
        parser.error("squelch and gain must be finite")
    if args.fast and args.mode != "replay":
        parser.error("--fast applies to replay mode")

    # Native drivers sometimes print to stdout. Keep the protocol pipe separate.
    signal.signal(signal.SIGPIPE, signal.SIG_DFL)
    with os.fdopen(os.dup(sys.stdout.fileno()), "wb") as protocol:
        os.dup2(sys.stderr.fileno(), sys.stdout.fileno())
        try:
            profile = load_profile(args.profile)
            writer = FrameWriter(protocol)
            if args.mode == "replay":
                emit_replay(profile, writer, args.fast)
            else:
                try:
                    from flowgraph import run_graph
                except ModuleNotFoundError as exc:
                    raise RuntimeError(f"GNU Radio live/IQ dependency unavailable: {exc.name}; check the configured Python") from exc
                run_graph(profile, writer, args)
        except (KeyError, TypeError, ValueError, OSError, RuntimeError) as exc:
            print(f"receiver: {exc}", file=sys.stderr)
            return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
