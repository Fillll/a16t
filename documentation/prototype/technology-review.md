# Technology Review

> **Prototype archive.** This page describes the earlier Python prototype. Its commands, paths, release numbers, and plans apply to that implementation. For the Rust application, see the [current documentation](../README.md).

## Scope

This review is intentionally critical. It covers packages and infrastructure for the A16T proof of concept, assuming:

- The first hardware target is an RTL-SDR Blog V3 dongle.
- The proof of concept should stay Python-first when practical.
- The app should monitor several nearby channels at once.
- The UI/backend should still run without radio hardware attached.

## Recommendation

Keep the web app small and Python-first. Put all radio capture and DSP behind a `RadioEngine` interface. Use GNU Radio as one live backend if it gets us reliable multi-channel airband monitoring fastest, but do not let GNU Radio become the app architecture.

Backend status:

1. `no-radio`: implemented for UI/API work without hardware.
2. `replay`: implemented with deterministic synthetic audio and demodulated WAV fixture replay.
3. `gnuradio`: implemented as the current live RTL-SDR AM/NFM path behind the radio engine interface.
4. `radio-stream fixtures`: implemented as short RTL-SDR capture plus metadata/data validation for pre-demodulation IQ captures, not yet as IQ replay.
5. `rtlsdr_python`: still an experimental direct Python path using an RTL-SDR Python binding plus NumPy/SciPy DSP.

This keeps the proof of concept moving while giving us a clean escape hatch if GNU Radio packaging becomes painful.

## Hardware Assumption: RTL-SDR Blog V3

The V3 is a good proof-of-concept target for airband and marine receive-only work, but the app should model it explicitly:

- Device kind: `rtlsdr_v3`.
- Center frequency and sample rate per capture group.
- Manual gain and PPM correction.
- Bias tee off by default.
- Bias tee enabled only when the user intentionally powers an LNA or other compatible device.

The RTL-SDR Blog V3 guide documents a software-selectable 4.5V bias tee and warns against enabling it into a DC-shorted antenna without an LNA. That belongs in setup docs and profile validation.

## Current Package Review

### Keep

- `fastapi`: good fit for a local API, static serving, and future server-sent events.
- `uvicorn`: appropriate local ASGI server.
- `numpy`: required for audio/DSP and tests.
- `sqlite3` from the standard library: enough for local metadata.
- `urllib.request` from the standard library: sufficient for the first OpenAI multipart upload provider without adding a runtime HTTP client.
- `httpx`: keep in the dev extra for FastAPI/Starlette test client support.
- `pytest`: keep the test loop lightweight.

### Removed Or Deferred

- `jinja2`: removed because the app serves static HTML directly.
- `pydantic`: deferred until profiles or API schemas need it.
- `pytest-asyncio`: deferred until async event-stream tests exist.
- `uvicorn[standard]`: convenient, but pulls extra runtime packages. Fine for the POC, but plain `uvicorn` may be enough if we want minimal installs.
- `mlx-whisper`: useful local experiment, but not the product default. Rename the extra to something like `local-transcription` later.

### Keep Isolated

- GNU Radio, SoapySDR, and RTL-SDR system drivers: do not pretend these are ordinary pip dependencies. Document them as radio runtime prerequisites.

## Radio Stack Options

### Option 1: GNU Radio Backend

Use GNU Radio for hardware source, channelization, demodulation, and audio-rate output into Python callbacks.

Pros:

- Mature DSP blocks.
- Good fit for multiple channels inside one capture window.
- AM and narrow FM demodulation cover the built-in aviation and marine profiles.
- Performance-critical work runs outside pure Python loops.

Cons:

- Heavy installation.
- Python bindings often follow the system package manager, not the project venv.
- Harder to test without hardware.
- Easy for the app to become coupled to flowgraph details.

Recommendation:

Keep as the first serious live backend, but isolate it. Do not import GNU Radio from service startup unless that backend is selected.

### Option 2: Direct Python RTL-SDR Backend

Use a Python RTL-SDR binding to read IQ samples, then do channelization and demodulation with NumPy/SciPy.

Pros:

- Feels like a Python proof of concept.
- Easier to debug and unit test.
- Smaller conceptual surface than GNU Radio.
- Directly matches the goal of owning the app logic in Python.

Cons:

- We must implement enough DSP correctly.
- Multi-channel filtering and resampling can become CPU-heavy.
- Real-time reliability is uncertain until measured.
- Binding and driver installation can still be OS-specific.

Recommendation:

Build this as an experiment after the `RadioEngine` interface exists. It may become the default if it handles the target channel count reliably.

### Option 3: SoapySDR Python Backend

Use SoapySDR as the hardware abstraction and do DSP in Python.

Pros:

- Vendor-neutral SDR interface.
- Cleaner future path to non-RTL hardware.
- SoapyRTLSDR exists as the RTL-SDR support module.

Cons:

- Still requires native SoapySDR and hardware modules.
- Python binding installation can be just as environment-sensitive as GNU Radio.
- Does not remove the need for DSP code.

Recommendation:

Consider this if we expect to support multiple SDR hardware families soon. Otherwise, use direct RTL-SDR first for the Python experiment.

### Option 4: `rtl_tcp` Worker

Run `rtl_tcp` as a separate process and connect from Python.

Pros:

- Separates driver lifecycle from app lifecycle.
- Can run radio on another machine.
- Easy to restart independently.

Cons:

- Another process to supervise.
- More latency and failure modes.
- Less direct device control.

Recommendation:

Useful later for remote radio placement. Not the first local laptop POC.

## Python Version Risk

The app currently requires Python `>=3.13`. That is fine for modern FastAPI code and tests, but it may be inconvenient for SDR stacks distributed through Homebrew, apt, conda, or GNU Radio builds. The radio backend should not force the web app and the hardware runtime into one interpreter if that becomes painful.

Options:

- Lower the app requirement to Python 3.11 or 3.12 if SDR bindings require it.
- Keep the web app on Python 3.13 and run the radio backend as a separate process using the Python version GNU Radio expects.
- Keep a fake/replay backend so UI and transcription work never block on SDR package installation.

Recommendation:

Do not change Python version yet. The radio backend is isolated now, so choose the Python version later based on actual RTL-SDR v3 runtime constraints.

## Proposed Next PRs

1. Add profile/runtime selection controls.
2. Add opt-in IQ/radio-stream replay through channelization and demodulation once a useful capture exists.
3. Add longer-session live verification notes for IAD AM and marine VHF NFM profiles.
4. Prototype `rtlsdr_python` only after replay fixtures are stable.

## References

- RTL-SDR Blog V3 user guide: <https://www.rtl-sdr.com/rtl-sdr-blog-v-3-dongles-user-guide/>
- pyrtlsdr documentation: <https://pyrtlsdr.readthedocs.io/en/latest/Overview.html>
- SoapySDR project: <https://github.com/pothosware/SoapySDR>
- SoapyRTLSDR support module: <https://github.com/pothosware/SoapyRTLSDR>
