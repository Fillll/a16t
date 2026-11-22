# Folder Structure

> **Prototype archive.** This page describes the earlier Python prototype. Its commands, paths, release numbers, and plans apply to that implementation. For the Rust application, see the [current documentation](../README.md).

The ideal A16T structure is a small monolith with strong internal boundaries. The app should stay easy to run locally, but files should live where their responsibilities are obvious.

In this repo, a boundary means: this folder owns one kind of responsibility, exposes a small contract to the rest of the app, and avoids importing details from folders above it. The goal is not to make the project big. The goal is to keep a small project from turning into one tangled file pile.

## Current 0.17.0 Structure

```text
.
├── AGENTS.md
├── README.md
├── VERSION.md
├── documentation/
├── pyproject.toml
├── profiles/
├── scripts/
│   └── dev.py
├── src/
│   └── a16t/
│       ├── core/
│       ├── demo/
│       ├── detection/
│       ├── profiles/
│       ├── radio/
│       │   ├── capture_fixtures.py
│       │   ├── preflight.py
│       │   ├── stream_fixtures.py
│       │   └── backends/
│       ├── recording/
│       ├── intelligence/
│       ├── storage/
│       ├── transcription/
│       │   └── providers/
│       └── web/
│           ├── events.py
│           └── static/
└── tests/
```

## Root Folders And Files

- `AGENTS.md`: contributor and agent rules for how work should happen in this repository.
- `README.md`: the first user-facing entry point: what A16T is, how to install it, and how to run it.
- `VERSION.md`: release notes. Every version update should explain what changed and why it matters.
- `documentation/`: product, architecture, UI, technology, and decision documentation. Larger code changes should follow this documentation. The folder intentionally avoids the GitHub Pages `/docs` convention.
- `pyproject.toml`: Python package metadata and canonical Python dependency list.
- `profiles/`: built-in radio profile files for aviation, marine, and later custom examples.
- `scripts/`: developer commands that replace ad-hoc shell instructions.
- `src/`: installable application source code.
- `tests/`: automated tests for the current behavior.

## A16T Package Folders

- `src/a16t/core/`: shared domain models, simple value objects, runtime paths, and cross-boundary settings.
- `src/a16t/demo/`: synthetic local demo scenarios that seed normal storage records for UI review without radio hardware.
- `src/a16t/detection/`: local activity detection, pre-roll, hang time, and segment creation logic.
- `src/a16t/profiles/`: profile loading, schema conversion, and validation.
- `src/a16t/radio/`: radio engine contracts, SDR capture, channelization, demodulation, backend implementations, radio-stream fixture capture/validation, and runtime preflight checks.
- `src/a16t/recording/`: WAV clip creation and recording-to-queued lifecycle handoff.
- `src/a16t/intelligence/`: transcript-based participant extraction, message classification, priority, confidence, and evidence rules.
- `src/a16t/storage/`: persistence adapters and database access.
- `src/a16t/transcription/`: speech-to-text worker and provider orchestration.
- `src/a16t/transcription/providers/`: transcription provider contracts and implementations for `null`, `openai`, and optional local modes.
- `src/a16t/web/`: FastAPI routes, local server startup, application orchestration, event streams, and static browser assets.
- `src/a16t/web/events.py`: web-layer event broker and Server-Sent Events frame formatting.
- `src/a16t/web/static/`: current HTML, CSS, and JavaScript for the browser UI.

## What Each Boundary Means

### `web`

This is the local web app boundary. It wires the pieces together, starts and stops services, exposes HTTP endpoints, and serves the browser UI from `web/static`.

Put code here when it answers questions like:

- How does the local server start?
- What API route should the browser call?
- How does the web app coordinate radio, storage, and transcription?
- What event stream contract should the browser consume?
- What does the watchboard show in the browser?
- How are active channels highlighted on screen?

Do not put DSP, transcription provider implementation, or database schema logic here unless it is only orchestration.

### `core`

This is the shared language of the app: simple data records, current configuration, and small concepts used across multiple boundaries.

Put code here when it answers questions like:

- What does a channel config look like?
- What does a transmission record contain?
- What paths and simple environment defaults does the current proof of concept share?

Keep it boring. If `core` becomes a junk drawer, move code back into the boundary that really owns it.

### `demo`

This folder owns synthetic local demo scenarios. Demo code may seed normal storage records and placeholder clips so the UI can show realistic history without SDR hardware, recorded fixtures, or paid transcription.

Put code here when it answers questions like:

- What should a realistic no-hardware UI demo show?
- Which synthetic transmissions belong to a named demo scenario?
- How do we populate a separate demo database with completed transmission history?

Demo code should not import web UI internals, radio hardware backends, transcription providers, or GNU Radio. The web startup may opt into a demo scenario, seed storage, and then treat demo records like ordinary stored transmissions.

### `profiles`

This folder owns profile parsing and validation. Profiles describe the radio domain, capture group, channels, modulation, detector defaults, and transcription prompt.

Put code here when it answers questions like:

- Does this profile file have the required fields?
- Do all channels reference a known capture group?
- Do the configured frequencies fit inside one SDR capture window?

Profile code should produce app configuration objects. It should not start radio hardware.

### `detection`

This folder decides when radio audio becomes a transmission worth recording. It owns pre-roll, hang time, thresholds, and segment creation.

Put code here when it answers questions like:

- Did a push-to-talk transmission start?
- How much audio should we keep before the detected start?
- When should one transmission end?

This code should not know about OpenAI, FastAPI, SQLite, or the browser.

### `radio`

This folder owns radio input, demodulation, radio-stream fixture capture/validation, and radio-runtime readiness checks. It contains the `RadioEngine` interface, the deterministic replay/no-radio backends, the GNU Radio live backend, fixture helpers, and preflight checks for the selected radio runtime.

Put code here when it answers questions like:

- How do we read from RTL-SDR Blog V3?
- How do we split one SDR capture window into several frequencies?
- How do we demodulate aviation AM or marine NFM?
- How do we capture short IQ/radio-stream fixtures from RTL-SDR?
- How do we validate pre-demodulation IQ/radio-stream fixtures?
- How do we emit normalized channel audio frames to detection?
- How do we explain missing radio runtime dependencies before live capture?

This code should emit audio frames or radio events. It should not decide when a detected segment becomes a clip, what the UI looks like, or which transcription provider gets paid.

### `recording`

This folder owns durable clip creation from detected transmissions. It bridges detection output into storage metadata and transcription queue jobs.

Put code here when it answers questions like:

- What clip path should a detected transmission use?
- How is a WAV file written for a bounded segment?
- When does a transmission move from `recording` to `queued`?

Recording should not know how radio frames are produced or how transcription providers work.

### `storage`

This folder owns durable local data. For now that means SQLite metadata and clip paths.

Put code here when it answers questions like:

- How are transmissions saved?
- How do transmission lifecycle states move forward?
- What app events were recorded for debugging?
- How are transcripts updated?
- How does the API fetch recent activity?

Storage should persist domain records, not raw GNU Radio objects, OpenAI responses, or browser-specific shapes.

### `transcription`

This folder owns speech-to-text behavior behind a provider boundary. The worker consumes completed clip jobs, builds provider requests, and stores provider results through the storage boundary.

Put code here when it answers questions like:

- How does a completed WAV clip become text?
- Which provider is active?
- How do we mark a transcript as complete or failed?
- Which provider and model produced a transcript?

This folder should respect the cost-control rule: transcription starts from bounded clips or locally gated realtime audio, not from idle radio streams.

Provider implementations live in `src/a16t/transcription/providers/`. Keep provider-specific API calls, request shaping, upload limits, and local backend fallbacks there, not in `web` or `storage`.

### `intelligence`

This folder owns deterministic post-transcription interpretation. It turns transcript text into a likely radio participant and message type while preserving confidence and evidence.

Put code here when it answers questions like:

- Which callsign, tail number, vessel, or station appears in this transcript?
- Is this traffic distress, urgency, weather, instruction, readback, routine, or unknown?
- What evidence caused the classification?

This folder should not call transcription providers, read raw radio frames, or decide how alerts are rendered in the browser.

## Where New Things Should Go

- New FastAPI route: `src/a16t/web/`.
- New browser event stream behavior: `src/a16t/web/events.py` and `src/a16t/web/api.py`.
- New shared dataclass used by multiple boundaries: `src/a16t/core/`.
- New synthetic UI/demo scenario: `src/a16t/demo/`.
- New squelch/activity algorithm: `src/a16t/detection/`.
- New profile parser or validation rule: `src/a16t/profiles/`.
- New built-in profile file: `profiles/`.
- New radio engine contract: `src/a16t/radio/engine.py`.
- New radio-stream fixture capture workflow: `src/a16t/radio/capture_fixtures.py`.
- New radio-stream fixture validation rule: `src/a16t/radio/stream_fixtures.py`.
- New RTL-SDR, GNU Radio, replay, or no-radio backend: `src/a16t/radio/backends/`.
- New clip recording behavior: `src/a16t/recording/`.
- New SQLite query or migration helper: `src/a16t/storage/`.
- New transcription provider: `src/a16t/transcription/providers/`.
- New participant or message classification rule: `src/a16t/intelligence/`.
- New browser view or styling: `src/a16t/web/static/`.
- New product or architecture decision: `documentation/`.
- New developer command: `scripts/`.
- New behavior check: `tests/`.

## Rules

- `web` may orchestrate lower boundaries; lower boundaries should not import `web`.
- `radio` should not know about FastAPI, SQLite tables, OpenAI, or browser UI.
- `detection` should operate on audio samples and emit segments, not make storage or transcription decisions.
- `recording` should turn detected segments into durable clips and queued clip jobs, not run transcription providers.
- `transcription` should hide provider details behind small interfaces.
- `intelligence` should interpret completed transcript text, not audio streams or browser state.
- `storage` should persist domain records, not provider-specific or GNU Radio-specific objects.
- Browser code in `web/static` should consume API/event contracts instead of reaching into backend implementation details.
- Demo scenarios should create ordinary storage records and stay independent of live radio, paid transcription, and browser rendering details.
