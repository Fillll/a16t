# Replay Fixtures

> **Prototype archive.** This page describes the earlier Python prototype. Its commands, paths, release numbers, and plans apply to that implementation. For the Rust application, see the [current documentation](../README.md).

Replay fixtures let A16T exercise detection, recording, storage, transcription-provider plumbing, intelligence, and UI state without live SDR hardware.

The replay backend has two modes:

- Synthetic replay: the default `replay` mode emits a deterministic activity burst on the first profile channel.
- Fixture replay: `replay` reads one or more WAV files and emits them as channel audio frames through the normal radio engine boundary.

## Single WAV Fixture

Use a WAV file when validating one channel:

```sh
python3 scripts/dev.py run-replay \
  --profile iad-airband \
  --replay-fixture path/to/tower.wav \
  --replay-channel iad-tower-120100
```

If `--replay-channel` is omitted, A16T replays the WAV on the first channel in the selected profile.

The same settings can come from environment variables:

```sh
export A16T_REPLAY_FIXTURE=path/to/tower.wav
export A16T_REPLAY_CHANNEL=iad-tower-120100
python3 scripts/dev.py run-replay --profile iad-airband
```

## Manifest Fixtures

Use a JSON manifest when validating multiple channel recordings:

```json
{
  "fixtures": [
    {
      "channel_key": "iad-tower-120100",
      "path": "tower.wav"
    },
    {
      "channel_key": "iad-ground-121900",
      "path": "ground.wav",
      "starts_after_sec": 0.5
    }
  ]
}
```

Run it with:

```sh
python3 scripts/dev.py run-replay \
  --profile iad-airband \
  --replay-fixture path/to/fixtures.json
```

Relative fixture paths are resolved from the manifest file's directory.

`starts_after_sec` controls fixture timestamps for validation; replay still emits the fixtures quickly rather than sleeping in real time.

## Fixture Expectations

- Use demodulated channel-audio WAV files, not IQ captures.
- Mono WAV is preferred; multi-channel WAV is downmixed to mono.
- 8-bit, 16-bit, and 32-bit PCM WAV are supported.
- WAV sample rates can differ from the profile audio rate; replay resamples locally before emitting frames.
- Keep normal development fixtures short. Longer captured samples should live outside the repo unless they are intentionally small.
- Include a little quiet audio before and after a real transmission when possible. Replay also adds local warmup and tail silence so the detector can establish noise floor and close the segment.

## What This Does Not Prove

Fixture replay starts after demodulation. It proves channel-audio detection and downstream app behavior, but it does not prove GNU Radio channelization, AM/NFM demodulation quality, antenna placement, gain, or PPM correction.

For earlier radio-stage validation, use [radio-stream fixtures](radio-stream-fixtures.md) to validate pre-demodulation IQ capture manifests. Actual IQ-to-channel-audio replay remains a later DSP milestone.
