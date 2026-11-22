# Runtime Preflight

> **Prototype archive.** This page describes the earlier Python prototype. Its commands, paths, release numbers, and plans apply to that implementation. For the Rust application, see the [current documentation](../README.md).

Runtime preflight is the operator check before starting live capture with A16T. It is meant to answer a practical question:

Can this checkout, profile, radio backend, runtime directory, and transcription configuration start a monitoring session without an obvious setup failure?

The browser Setup access and `GET /api/runtime` expose the current runtime mode, paths, diagnostic checks, and recent app events after the app starts. Use preflight before live capture; use Setup while the app is running.

Run the basic preflight:

```sh
python3 scripts/dev.py preflight
```

For hardware-free development, check the safe backends explicitly:

```sh
python3 scripts/dev.py preflight --radio-backend no-radio
python3 scripts/dev.py preflight --radio-backend replay --profile iad-airband
```

Before live RTL-SDR Blog V3 capture, run:

```sh
python3 scripts/dev.py preflight --profile iad-airband --radio-backend gnuradio --hardware
python3 scripts/dev.py preflight --profile marine-vhf --radio-backend gnuradio --hardware
```

The command exits with `0` when there are no failed checks. Warnings still exit with `0` because some warnings are intentional, such as skipping the hardware probe on a laptop without the dongle attached. Failed checks exit with `1`.

## What It Checks

Preflight currently checks:

- selected profile exists and passes profile validation.
- `runtime_data/`, `runtime_data/clips/`, and `runtime_data/logs/` are writable.
- selected radio backend is one of `no-radio`, `replay`, or `gnuradio`.
- live GNU Radio profile compatibility:
  - AM and NFM modulation for the current live backend.
  - one capture group only.
  - RTL-SDR Blog V3 device kind.
- profile bias tee state.
- GNU Radio Python modules required by the current live backend.
- `rtl_test` availability from the RTL-SDR tools.
- `SoapySDRUtil` availability for SDR runtime diagnostics.
- optional attached hardware probe through `rtl_test -t`.
- transcription provider readiness:
  - `null` is always safe and no-cost.
  - `openai` requires `A16T_OPENAI_API_KEY` or `OPENAI_API_KEY`.
  - `local` requires MLX Whisper or configured whisper.cpp paths.

## Local Transcription

An executable `WHISPER_CPP_BIN` and a valid `WHISPER_CPP_MODEL` file select whisper.cpp before MLX Whisper. This allows a CPU build of whisper.cpp to run on systems or in sessions without Metal access.

```sh
export WHISPER_CPP_BIN=/path/to/whisper-cli
export WHISPER_CPP_MODEL=/path/to/ggml-model.bin
python3 scripts/dev.py preflight --profile eastbay-marine --radio-backend replay --transcription-provider local
python3 scripts/dev.py run-replay --profile eastbay-marine --replay-fixture /path/to/speech.wav --transcription-provider local
```

Preflight checks for installed modules or model and binary paths. Replay a known speech sample to verify that the backend actually starts and produces a transcript. The default synthetic replay is a detector test signal.

## RTL-SDR Blog V3 Setup Expectations

The first hardware target is RTL-SDR Blog V3. A live `gnuradio` run needs system/runtime packages outside the normal Python app dependencies:

- GNU Radio with Python bindings visible to the interpreter running A16T.
- GNU Radio Soapy blocks.
- SoapySDR runtime.
- SoapyRTLSDR or equivalent RTL-SDR support.
- RTL-SDR command-line tools, especially `rtl_test`.
- OS permissions that allow the current user to open the USB SDR device.

These are system/runtime dependencies, not normal pip packages. Keep them out of the app install path unless a future ADR changes the runtime model.

## Bias Tee Safety

Bias tee is off by default in the built-in profiles.

Only enable bias tee when an attached powered LNA or device explicitly expects RTL-SDR Blog V3 bias tee power. Do not enable it for an unknown antenna or a DC-shorted antenna path. Treat any profile with `"bias_tee": true` as an intentional hardware decision that deserves review before live capture.

Preflight warns when a selected profile enables bias tee. It does not silently disable profile settings.

## Hardware Probe

The `--hardware` flag runs:

```sh
rtl_test -t
```

That check confirms the RTL-SDR tools can see and open the dongle. If it fails, common causes are:

- the dongle is not attached.
- another SDR app is using it.
- OS USB permissions are blocking access.
- the RTL-SDR driver or SoapyRTLSDR support module is not installed correctly.

Hardware probing is opt-in so automated tests and UI development stay usable without radio hardware.

See [live-hardware-verification.md](live-hardware-verification.md) for the manual RTL-SDR Blog V3 checklist and current hardware-probe troubleshooting notes.

## Current Limits

Preflight is not a radio-quality test. It does not prove antenna placement, local RF conditions, gain, PPM correction, demodulation quality, or transcription accuracy.

Preflight verifies profile-level live compatibility for supported AM and NFM channels. It still does not prove that a specific local antenna placement or RF environment will produce usable audio; use replay fixtures and manual live checks for that.
