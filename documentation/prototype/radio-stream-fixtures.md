# Radio-Stream Fixtures

> **Prototype archive.** This page describes the earlier Python prototype. Its commands, paths, release numbers, and plans apply to that implementation. For the Rust application, see the [current documentation](../README.md).

Radio-stream fixtures are pre-demodulation SDR captures. They sit earlier in the radio pipeline than WAV replay fixtures:

```text
RTL-SDR IQ capture -> radio-stream fixture -> channelization/demodulation validation -> channel-audio WAV replay -> detection/storage/UI
```

The `0.16.0` milestone can capture short RTL-SDR IQ files, generate manifests, and validate them. It does not yet replay IQ through GNU Radio or convert IQ into channel audio in normal tests. That replay path should be a later DSP milestone after the manifest format is stable.

## Capture A Fixture

Use the local RTL-SDR command-line tools to capture a short receive-only fixture:

```sh
python3 scripts/dev.py capture-radio-fixture \
  --profile iad-airband \
  --duration-sec 0.25
```

By default this writes files under ignored local runtime storage:

```text
runtime_data/fixtures/
```

The command writes:

- `<name>.cu8`: unsigned 8-bit interleaved IQ data from `rtl_sdr`.
- `<name>.radio-stream.json`: manifest generated from the selected profile and measured file size.

The command validates the manifest immediately after capture. Use `--name` for a stable file name and `--overwrite` only when you intentionally want to replace existing local fixture files:

```sh
python3 scripts/dev.py capture-radio-fixture \
  --profile marine-vhf \
  --duration-sec 0.25 \
  --name marine-smoke \
  --overwrite
```

Other useful options:

- `--capture-group`: select a non-primary capture group when profiles eventually have more than one.
- `--device`: RTL-SDR device index or serial, default `0`.
- `--output-dir`: fixture output directory.
- `--rtl-sdr-path`: explicit path to the `rtl_sdr` executable.
- `--notes`: text stored in the manifest.

## Validate A Fixture

Use:

```sh
python3 scripts/dev.py validate-radio-fixture path/to/iad-core.radio-stream.json
```

The command exits with `0` when the manifest has no failed checks. Warnings still exit with `0`; for example, a missing checksum is a warning because the file can be inspected, but it is not yet ideal for repeatable validation.

## Manifest Format

Example:

```json
{
  "version": 1,
  "kind": "radio-stream-fixture",
  "profile_id": "iad-airband",
  "capture_group_id": "iad-core",
  "data": {
    "path": "iad-core.c64",
    "sample_format": "complex64",
    "center_frequency_hz": 121000000,
    "sample_rate_hz": 2400000,
    "duration_sec": 0.25,
    "sha256": "replace-with-real-sha256"
  },
  "expected_channels": [
    {
      "channel_key": "iad-tower-120100",
      "expected_activity": "unknown"
    }
  ],
  "notes": "Short receive-only capture for validating the IAD capture group."
}
```

Fields:

- `version`: currently `1`.
- `kind`: must be `radio-stream-fixture`.
- `profile_id`: profile file id, such as `iad-airband` or `marine-vhf`.
- `capture_group_id`: capture group from the selected profile.
- `data.path`: IQ/radio-stream data file, resolved relative to the manifest.
- `data.sample_format`: one of `complex64`, `c64`, `interleaved-f32`, `f32iq`, `interleaved-i16`, `cs16`, `interleaved-u8`, or `cu8`. The capture command writes `interleaved-u8`.
- `data.center_frequency_hz`: center frequency used for the capture.
- `data.sample_rate_hz`: sample rate used for the capture.
- `data.duration_sec`: capture duration implied by the file.
- `data.sha256`: recommended checksum for repeatable validation.
- `expected_channels`: profile channel ids the fixture is meant to validate later.

The validator checks that:

- the manifest is valid JSON with the expected schema version and kind.
- the profile and capture group exist.
- center frequency and sample rate match the profile capture group.
- the data file exists and is not empty.
- the file size is divisible by the selected complex sample format.
- file size and sample rate match `duration_sec`.
- `sha256` matches when provided.
- each expected channel exists in the selected profile and capture group.

## Storage Rules

Keep normal CI lightweight:

- Do not commit large IQ captures.
- Put local captures under `runtime_data/fixtures/` or outside the repo; `runtime_data/` is ignored.
- Commit only tiny fixtures if they are intentionally small and useful for automated tests.
- Prefer committing manifests and checksums over binary data when captures are large.

## What This Proves

Today, this validates that an IQ/radio-stream artifact is well-described and profile-compatible. That is useful because later channelization and demodulation tests can trust the fixture metadata.

It does not yet prove:

- GNU Radio can demodulate the fixture into useful audio.
- the antenna placement or local RF environment is good.
- gain or PPM settings are correct.
- the selected channels contain intelligible traffic.

For those questions, use live hardware checks and future opt-in IQ replay tests.
