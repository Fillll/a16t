# Implementation Plan To 1.0.0

> **Prototype archive.** This page describes the earlier Python prototype. Its commands, paths, release numbers, and plans apply to that implementation. For the Rust application, see the [current documentation](../README.md).

## Purpose

This document defines the desired A16T `1.0.0` state and the implementation path from the current `0.17.0` codebase.

The goal of `1.0.0` is not to finish every idea in the product docs. The goal is to deliver the first genuinely useful local monitoring app:

- Choose one aviation or marine profile.
- Monitor several nearby frequencies at the same time when they fit inside one RTL-SDR capture window.
- Show live channel activity immediately.
- Detect transmissions locally with pre-roll.
- Record bounded clips only when activity is detected.
- Transcribe detected clips without streaming idle audio to paid APIs.
- Review recent activity, transcripts, clips, and basic classifications on a small laptop screen.

## Current Baseline

Current version: `0.17.0`.

The repo already has:

- Boundary-oriented package layout under `src/a16t/`.
- Local FastAPI web app under `src/a16t/web/`.
- Static browser UI under `src/a16t/web/static/`.
- Built-in JSON profile files for IAD airband and the expanded U.S. lower marine VHF configuration.
- A radio engine boundary with `no-radio`, `replay`, and GNU Radio backends.
- Fixture-backed replay for demodulated WAV channel-audio files and JSON replay manifests.
- A no-hardware Treasure Island / San Francisco Bay demo mode that seeds synthetic maritime transmission history into a separate local database.
- Short RTL-SDR IQ/radio-stream fixture capture into ignored local runtime storage.
- Radio-stream fixture manifest validation for pre-demodulation IQ captures.
- A GNU Radio live backend for one RTL-SDR aviation AM or marine VHF NFM window.
- Local activity detection, pre-roll, hang time, WAV clip writing, and SQLite metadata.
- Explicit transmission lifecycle states, storage migration, app events, and a recording boundary.
- Explicit transcription provider boundary with `null`, `openai`, and optional local modes.
- Bounded OpenAI clip transcription provider with upload-size guardrail.
- Provider/model status in storage, API state, and browser header.
- Server-Sent Events through `GET /events` for browser state updates.
- Small-screen Watchboard UI with event-driven browser updates.
- Dense Watchboard band mode for larger profile channel sets.
- First-pass transcript intelligence for participant extraction, message classification, confidence, and evidence.
- Watchboard participant/message badges plus emergency and urgent alert treatment.
- Review mode for filtering recent transmissions by channel, priority, and transcript/intelligence text.
- `GET /api/transmissions` for review-oriented transmission queries.
- Manual correction for participant label/kind and message type/priority through detail-view controls and `PATCH /api/transmissions/{id}`.
- Runtime preflight command for profile, runtime path, radio dependency, optional hardware, and transcription readiness checks.
- RTL-SDR Blog V3 setup and bias tee safety documentation.
- Runtime diagnostics API and compact browser Setup access for profile, backend, transcription, paths, checks, and recent app events.
- Basic tests for API state, runtime diagnostics, review filtering, runtime preflight behavior, GNU Radio AM/NFM modulation routing, radio-stream fixture capture/validation, event streaming, detector behavior, profiles, synthetic and fixture replay, demo seeding, no-radio startup, recording, storage lifecycle, transcription providers, manual correction, and intelligence rules.

The main missing pieces after `0.17.0` are:

- Actual IQ/radio-stream replay through channelization and demodulation.
- Longer-session release checklist and manual verification notes.

## 1.0.0 Product Definition

`1.0.0` should feel like a compact local monitoring console.

### Must Have

- One local backend process.
- One browser UI served by the backend.
- Automated tests for every feature described in this implementation plan.
- One active profile at a time.
- Built-in example profiles:
  - IAD aviation airband.
  - Marine VHF lower-band profile.
- One RTL-SDR Blog V3 live backend through GNU Radio.
- One replay backend for development and tests without hardware.
- Multiple simultaneous channels when they fit inside one configured capture group.
- Profile validation that explains when channels do not fit into one SDR capture window.
- Per-channel activity state:
  - `idle`
  - `detecting`
  - `recording`
  - `queued`
  - `transcribing`
  - `complete`
  - `failed`
- Local activity detection with defaults:
  - pre-roll: `0.75s`
  - minimum duration: `0.35s`
  - hang time: `0.8s`
  - maximum segment duration: `45s`
- One WAV clip per detected transmission.
- SQLite storage for profiles, channels, transmissions, transcript status, clips, participants, message classification, and app events.
- OpenAI request-based transcription provider for bounded clips.
- Null transcription provider for offline/no-cost development.
- Cost guardrails:
  - transcription disabled unless configured.
  - maximum clip duration.
  - visible transcription mode and status.
  - failed/retryable transcript states.
- Server-sent events for channel activity and transcript updates.
- Small-laptop Watchboard with live channel rail and active transmission detail.
- Timeline or recent activity view for the last several hours.
- Transcript detail with clip playback.
- Basic message classification:
  - distress
  - urgency
  - safety
  - weather
  - clearance/instruction
  - acknowledgement/readback
  - routine
  - unknown
- Basic participant extraction from transcript text:
  - aviation callsigns.
  - tail numbers.
  - station names.
  - marine vessel names.
- Emergency/distress visual treatment that does not rely on color alone.
- Setup/preflight docs for RTL-SDR Blog V3, GNU Radio, and bias tee safety.
- Tests that can run without SDR hardware or paid API calls.

### Should Have

- Minimal setup UI for selecting a profile and transcription mode.
- Profile-specific transcription prompts.
- Manual correction fields for participant and message type/priority.
- Per-channel threshold overrides.
- Simple app event log for debugging radio/transcription lifecycle.
- Exportable clip/transcript metadata through the API.

### Not Required For 1.0.0

- Multiple SDR devices at once.
- Multiple active capture groups at once.
- Mixed aviation and marine monitoring at the same time with one dongle.
- Realtime transcription deltas or always-on realtime transcription.
- Voice biometric identification.
- ADS-B or AIS enrichment.
- Full mobile app polish.
- Cloud deployment.

## Transcription Strategy

The `1.0.0` default should be request-based transcription of completed bounded clips.

Reason:

- It follows ADR 0002: detect locally before paid transcription.
- It avoids paying for idle channels.
- It keeps the first OpenAI integration simple and testable.
- Most aviation and marine radio turns are short enough that post-segment transcript latency is acceptable for a first useful version.

Current OpenAI docs distinguish bounded file/request transcription from realtime transcription. For bounded clips, use the Audio API speech-to-text path. For realtime transcript deltas from live audio, use Realtime transcription.

Recommended `1.0.0` provider shape:

- `TranscriptionProvider` protocol.
- `NullTranscriptionProvider`.
- `OpenAIClipTranscriptionProvider`.
- `LocalTranscriptionProvider` kept optional, not the product default.

Recommended OpenAI model defaults:

- Accuracy-first default: `gpt-4o-transcribe`.
- Lower-cost option: `gpt-4o-mini-transcribe`.
- Legacy/local compatibility option: keep local Whisper paths optional.

Realtime transcription is explicitly post-`1.0.0`. When added later, it should still start only after local detection fires, send pre-roll first, and close after local hang time. For server-side radio audio, WebSocket is the likely integration path.

References checked 2026-06-13:

- [OpenAI speech to text](https://developers.openai.com/api/docs/guides/speech-to-text)
- [OpenAI realtime transcription](https://developers.openai.com/api/docs/guides/realtime-transcription)
- [OpenAI realtime VAD](https://developers.openai.com/api/docs/guides/realtime-vad)
- [OpenAI realtime WebSocket](https://developers.openai.com/api/docs/guides/realtime-websocket)

## Target Architecture

```text
src/a16t/
  core/
    models.py
    events.py
    settings.py
  demo/
    treasure_island.py
  profiles/
    loader.py
    schema.py
    validation.py
  radio/
    engine.py
    backends/
      gnuradio.py
      null.py
      replay.py
  detection/
    activity.py
    segmenter.py
  recording/
    recorder.py
  transcription/
    providers/
      null.py
      openai.py
      local.py
    worker.py
  intelligence/
    rules.py
  storage/
    sqlite.py
    migrations.py
  web/
    api.py
    events.py
    main.py
    service.py
    static/
profiles/
  iad-airband.json
  marine-vhf.json
```

This is still one local app. These folders are boundaries, not separate services.

## Data Model

### Profile

Profiles should define:

- `id`
- `label`
- `domain`: `aviation`, `marine`, or `custom`
- capture groups
- channels
- modulation per channel
- detection defaults
- transcription prompt
- message taxonomy overrides

### Capture Group

Capture groups should define:

- `id`
- `device_kind`
- `center_frequency_hz`
- `sample_rate_hz`
- `gain_db`
- `ppm_error`
- `bias_tee`
- list of channel ids

For `1.0.0`, only one active capture group is required.

### Transmission

Transmission records should include:

- `id`
- `profile_id`
- `channel_id`
- `capture_group_id`
- `frequency_hz`
- `started_at`
- `ended_at`
- `duration_ms`
- `state`
- `clip_path`
- `peak_level`
- `transcript_text`
- `transcript_status`
- `transcription_provider`
- `transcription_model`
- participant fields
- message classification fields
- confidence/evidence fields

### App Event

App events should include:

- channel activity changes.
- segment started/ended.
- clip queued.
- transcription started/completed/failed.
- classification updated.
- radio backend errors.

Events are used for the UI stream and for debugging.

## API Surface

Required endpoints:

- `GET /api/state`
- `GET /api/profiles`
- `GET /api/profiles/{profile_id}`
- `POST /api/runtime/profile`
- `GET /api/channels`
- `GET /api/transmissions` with review filters for window, channel, priority, state, query, and limit.
- `GET /api/transmissions/{id}`
- `PATCH /api/transmissions/{id}`
- `GET /clips/{id}.wav`
- `GET /events`

Use Server-Sent Events for `GET /events` in `1.0.0`. The app mostly needs backend-to-browser updates, and SSE is simpler than WebSocket for that first contract.

## UI Scope For 1.0.0

### Watchboard

The Watchboard is the primary `1.0.0` UI.

It should show:

- profile name.
- SDR/backend state.
- transcription mode.
- clock or generated-at timestamp.
- active alert banner when needed.
- one compact row per channel.
- active channels first.
- signal level.
- current state.
- timer for active transmission.
- latest transcript preview.
- participant badge when known.
- message type badge when known.

### Timeline

The Timeline can be simple in `1.0.0`.

It should show:

- recent transmissions grouped by time.
- channel/frequency.
- duration.
- transcript status.
- message type.
- participant when known.
- clip playback access.

Small screens may use an event list instead of dense horizontal lanes.

### Transcript Detail

Transcript detail should show:

- transcript text.
- audio player.
- channel.
- timestamps.
- participant fields.
- message classification.
- compact confidence/evidence access near participant and message fields, without spending full rows on confidence values.
- failed transcription message when relevant.

Manual correction can be basic. It does not need a full review workflow in `1.0.0`.

### Setup

Setup can be minimal:

- pick built-in profile.
- show whether configured channels fit the capture group.
- show selected transcription provider/model.
- show radio backend mode: `replay`, `gnuradio`, or `no-radio`.

Full channel editing can wait until after `1.0.0`.

## Milestones

### 0.3.0 - Profiles

Status: implemented in `0.3.0`.

Deliver:

- `profiles/` folder.
- IAD airband profile file.
- Marine VHF lower-band profile file.
- Profile schema and validation.
- Profile loader tests.
- Runtime config loads channels from selected profile instead of Python constants.

Acceptance:

- App starts with IAD profile.
- App starts with marine profile in no-radio/replay mode.
- Invalid profiles fail with clear validation errors.
- Tests prove out capture-window fit validation.

### 0.4.0 - Radio Engine Boundary

Status: implemented in `0.4.0`.

Deliver:

- `RadioEngine` interface.
- `ChannelAudioFrame` and radio state event models.
- GNU Radio backend moved behind the interface.
- Replay backend for deterministic tests and UI development.
- No-radio backend kept for UI/API work.

Acceptance:

- `web` does not import GNU Radio directly.
- Tests run without GNU Radio installed.
- Replay backend can emit channel activity from fixtures or synthetic samples.
- GNU Radio backend can still run with RTL-SDR Blog V3.

### 0.5.0 - Segment Lifecycle And Storage

Status: implemented in `0.5.0`.

Deliver:

- Segment recorder boundary.
- Explicit transmission states.
- SQLite schema/migration path.
- App event table or event log.
- Clip retention settings.
- Storage tests for state transitions and queries.

Acceptance:

- Every detected segment moves through `recording`, `queued`, `transcribing`, and terminal states.
- Clip metadata survives restart.
- API can fetch recent transmissions efficiently.

### 0.6.0 - Transcription Provider Boundary

Status: implemented in `0.6.0`.

Deliver:

- `TranscriptionProvider` interface.
- `OpenAIClipTranscriptionProvider`.
- `NullTranscriptionProvider`.
- Optional local provider retained behind explicit config.
- Profile-specific transcription prompt.
- Cost guardrails and status reporting.
- Mocked provider tests.

Acceptance:

- With no API key, app runs with null transcription.
- With OpenAI configured, bounded clips are sent for transcription after segment end.
- Failed transcription is visible in storage, API responses, and the browser detail view.
- Idle audio never leaves the machine.

### 0.7.0 - Event Stream And Watchboard

Status: implemented in `0.7.0`.

Deliver:

- Server-Sent Events endpoint.
- Browser event client.
- Small-laptop Watchboard layout.
- Live rail with active channels first.
- Active/recording/transcribing/complete visual states.
- Collapsible selected transmission detail.

Acceptance:

- Activity appears in the UI through the event stream instead of fixed browser polling.
- Small laptop viewport remains usable.
- Detection and transcription states are visually distinct.
- Watchboard works with replay backend.

### 0.8.0 - Intelligence And Alerts

Status: implemented in `0.8.0`.

Deliver:

- Distress/urgency keyword rules.
- Message type classifier for basic categories.
- Transcript-based participant extraction.
- Participant and message fields in storage/API.
- Alert treatment for distress and urgency.
- Tests for aviation and marine examples.

Acceptance:

- `Mayday`, `Pan-pan`, and `Securite` style traffic receives clear treatment.
- Basic aviation callsigns and marine vessel names are extracted when present.
- UI shows confidence and evidence in detail while keeping badges compact.
- False-positive correction remains a later transcript review feature.

### 0.9.0 - Review Views

Status: implemented in `0.9.0`.

Deliver:

- Review mode over recent transmissions.
- Filterable `GET /api/transmissions` endpoint.
- Channel, priority, and text filters.
- Shared transcript detail inspector for Live and Review modes.
- Small-screen Review layout opened from compact secondary controls instead of a large persistent mode bar.

Acceptance:

- User can review the last several hours of transmissions.
- User can filter recent activity by channel and priority.
- User can search transcript and intelligence text.
- Review mode stays usable on small laptop and phone-width screens without taking persistent vertical space from monitoring.

### 0.10.0 - Runtime Setup And Preflight

Status: implemented in `0.10.0`.

Deliver:

- RTL-SDR Blog V3 setup docs.
- Radio preflight checks.
- Structured command-line diagnostics for profile, runtime paths, radio dependencies, optional hardware probing, and transcription provider readiness.
- Bias tee safety guidance.
- Automated tests for hardware-free and failure-reporting behavior.

Acceptance:

- User can run preflight before live capture.
- Hardware and transcription failures are understandable.
- CI and UI development can run preflight checks without SDR hardware.
- Attached RTL-SDR Blog V3 probing is opt-in through `--hardware`.

### 0.11.0 - Runtime Diagnostics And Setup Surface

Status: implemented in `0.11.0`.

Deliver:

- Setup/status view or endpoint for selected profile, backend, transcription provider, and preflight state.
- Clearer web-visible error surfaces for startup/runtime failures.
- Basic app event log view for radio/transcription lifecycle diagnostics.
- Compact Setup workspace for paths, capture settings, checks, and recent app events, opened from secondary controls unless warnings/errors need stronger treatment.

Acceptance:

- User can understand runtime mode and obvious setup failures from the browser.
- Hardware and transcription failures are visible without reading terminal logs.
- Setup surface stays usable on small laptop and phone-width screens.

### 0.12.0 - Manual Correction And Review Edits

Status: implemented in `0.12.0`.

Deliver:

- API support for editing participant and message metadata on a transmission.
- Browser controls for correcting participant label/kind and message type/priority.
- App events for manual corrections.
- Tests for correction persistence, API serialization, validation, and UI data shape.

Acceptance:

- User can fix obvious participant and message-classification mistakes.
- Corrections survive refresh and remain visible in Review and detail surfaces.
- Rule-based uncertainty stays visible rather than pretending corrections are automatic truth.

### 0.13.0 - Replay Fixtures And Live Backend Validation

Status: implemented in `0.13.0`.

Deliver:

- Fixture-backed replay for demodulated WAV channel audio.
- CLI and environment configuration for selecting a replay fixture and target channel.
- JSON replay manifest support for multiple channel-targeted fixtures.
- Service-level validation that fixture audio flows through detection, recording, storage, transcription-provider plumbing, and intelligence.
- Documentation for fixture format, manifest use, and validation limits.

Acceptance:

- User can run a known WAV fixture without SDR hardware.
- Fixture replay stays behind the radio backend boundary.
- Tests can validate channel-audio replay without GNU Radio, SDR hardware, OpenAI credentials, or checked-in large binary fixtures.
- Docs clearly distinguish demodulated WAV fixtures, validated radio-stream manifests, and future IQ replay.

### 0.14.0 - Marine NFM Live Backend

Status: implemented in `0.14.0`.

Deliver:

- GNU Radio live backend support for marine VHF NFM channels behind the existing radio boundary.
- Shared live-modulation support rules for the live backend, preflight, and runtime diagnostics.
- CI-safe tests that prove marine channels select the NFM demodulator without requiring GNU Radio or SDR hardware.
- Updated README, runtime preflight, profile, architecture, current-state, folder-structure, technology, and version notes.

Acceptance:

- The marine VHF profile passes preflight modulation compatibility with the `gnuradio` backend.
- Runtime diagnostics show marine NFM as live-supported.
- The live flowgraph chooses GNU Radio NFM demodulation for marine profile channels.
- `no-radio` and `replay` remain usable without importing GNU Radio.

### 0.15.0 - Radio-Stream Fixture Validation

Status: implemented in `0.15.0`.

Deliver:

- Radio-stream fixture manifest validation behind the `radio` boundary.
- Developer command for validating fixture manifests without requiring SDR hardware.
- Manifest format documentation for pre-demodulation IQ/radio-stream captures.
- Live hardware verification notes for RTL-SDR Blog V3 troubleshooting.
- Tests for manifest/profile compatibility, file size, duration, checksum, and expected channels.

Acceptance:

- A small IQ/radio-stream fixture manifest can be validated against a built-in profile.
- Invalid duration, checksum, and expected-channel metadata fail with clear messages.
- Missing checksum warns without blocking local inspection.
- Normal CI remains hardware-free and does not require large binary fixtures.
- Docs clearly state that actual IQ-to-channel-audio replay is still a later DSP milestone.

### 0.16.0 - Radio-Stream Fixture Capture

Status: implemented in `0.16.0`.

Deliver:

- RTL-SDR capture command that writes short local unsigned 8-bit interleaved IQ fixtures.
- Generated radio-stream fixture manifests using selected profile capture settings.
- Immediate post-capture validation through the existing manifest validator.
- Ignored default output location under `runtime_data/fixtures/`.
- Tests using a fake `rtl_sdr` runner so normal CI stays hardware-free.

Acceptance:

- User can run `python3 scripts/dev.py capture-radio-fixture --profile iad-airband --duration-sec 0.25`.
- Captured fixtures produce `.cu8` data and `.radio-stream.json` manifest files.
- Generated manifests include center frequency, sample rate, measured duration, checksum, capture settings, and expected channels.
- Capture failures clean up partial data and report the `rtl_sdr` failure clearly.
- Large binary IQ fixtures remain outside the tracked repo by default.

### 0.17.0 - Expanded Marine Band Watchboard

Status: implemented in `0.17.0`.

Deliver:

- Expanded Marine VHF profile with the U.S. lower marine channels that fit the current RTL-SDR capture window.
- A dense Watchboard band layout for larger channel sets.
- Stable channel-number ordering in dense marine mode so the band reads from 1A through 88 instead of RF frequency order.
- Sparse horizontal channel time lanes with channel numbers pinned at the left, transmission moments plotted on the X axis, and constant spacing between channels.
- Short Watchboard time scales, including 15-minute and 1-hour windows, for close monitoring on a small screen.
- Vertical dotted time markers with top and bottom marker labels: 3-hour markers for the 24-hour window, hourly markers for mid-range windows, 15-minute markers for the 1-hour window, and 5-minute markers for the 15-minute window.
- Responsive time-grid density so narrow browser widths automatically reduce tick frequency instead of letting hour labels overlap.
- Hover text on transmission segments shown as one custom bubble with three compact lines: 24-hour start time, speaker/participant, and message classification.
- Emergency, urgent, advisory, live, and idle state text inside expanded line markers so priority does not rely on color alone.
- Documentation that NOAA weather, AIS, and upper duplex coast-side frequencies require another capture window or later profile support.
- Synthetic Treasure Island / San Francisco Bay demo mode with realistic busy-day maritime activity across VTS, bridge-to-bridge, Coast Guard, commercial, marina, and recreational channels.
- Tests proving the marine profile loads the expanded channel set and keeps expected bounds.
- Tests proving demo mode seeds realistic completed transmission metadata without using Channel 70 voice traffic.

Acceptance:

- `marine-vhf` exposes the expanded lower-band channel set through `/api/state`.
- The Watchboard renders larger channel sets as thin channel lines instead of long transcript rows.
- The dense marine Watchboard orders lanes by visible channel number from 1A through 88.
- The state and event APIs accept the 15-minute `0.25` hour window used by the UI.
- Time-grid markers and their top/bottom labels update when the selected scale changes.
- Time-grid markers get sparser on narrow browser widths so top and bottom time labels do not overlap.
- Transmission segment hover text stays short enough for dense small-screen scanning by using one custom tooltip with 24-hour start time, speaker/participant, and message classification.
- Channel 16, Channel 22A, Channel 70, and Channel 88 are present in the marine profile.
- The expanded profile remains NFM-only and fits the configured capture group.
- `python3 scripts/dev.py run-no-radio --demo-scenario treasure-island-sf-bay` starts the marine profile with roughly 1,400-1,900 synthetic completed transmissions visible in the 24-hour Watchboard.
- Demo records use a separate ignored database and are clearly marked as synthetic through the runtime/state API.

### 1.0.0 - Basic Useful Release

Deliver:

- Final polish across docs, setup, tests, and UI.
- Version bump to `1.0.0`.
- `VERSION.md` release notes.
- Known limitations documented.
- Manual verification on replay backend.
- Manual verification on RTL-SDR Blog V3 when hardware/runtime is available.

Acceptance:

- A new user can follow docs, run the app without radio hardware, and understand the UI.
- A configured RTL-SDR Blog V3 can monitor the IAD AM or marine VHF NFM profile live.
- Several configured frequencies can be monitored together when they fit the capture group.
- Activity is visible immediately.
- Clips include pre-roll.
- Bounded clips can be transcribed through OpenAI when configured.
- Recent transmissions, transcripts, clips, participants, and message types are reviewable.
- No idle radio audio is sent to paid transcription.
- Every feature described in this implementation plan has corresponding automated test coverage or a documented hardware/manual verification case when automation is not practical.

## Cross-Cutting Work

### Testing

Every feature described in this implementation plan must have test coverage. A milestone is not complete until each feature in that milestone has one of:

- an automated unit test.
- an automated integration/API test.
- an automated browser/UI test.
- a documented hardware/manual verification case when full automation is not practical, such as RTL-SDR Blog V3 live capture.

Manual verification should be the exception. Hardware-dependent behavior should still have automated tests around profile validation, backend selection, event shape, error handling, and replay/fake equivalents.

Use the lowest test level that proves the behavior, but do not test below the behavior being claimed. For example, radio channelization needs radio-stream fixtures, while transcript parsing does not.

Recommended test levels:

| Feature area | Preferred test level | Fixture/input | Purpose |
| --- | --- | --- | --- |
| Profile parsing and capture-window fit | Unit tests | JSON profile fixtures | Validate configuration rules without radio hardware. |
| Radio engine interface | Unit and integration tests | Fake engine events and synthetic audio frames | Prove backend contracts and lifecycle behavior. |
| GNU Radio channelization and demodulation | Replay/integration tests | Pre-recorded IQ/radio stream fixtures when available | Prove that real captured spectrum is split into expected channel audio. |
| Replay backend | Integration tests | Pre-recorded IQ/radio streams or demodulated channel-audio fixtures | Prove UI and backend flows can run without hardware. |
| Activity detection and pre-roll | Unit and integration tests | Demodulated WAV/audio fixtures plus synthetic audio arrays | Prove start/end detection, hang time, minimum duration, and preserved pre-roll. |
| Segment recording | Integration tests | Audio fixtures | Prove WAV creation, metadata timing, peak level, and state transitions. |
| Transcription providers | Unit and integration tests with mocks | Recorded WAV clips and mocked provider responses | Prove provider request shape, prompt use, status updates, failures, and retries without spending API money in normal CI. |
| Participant extraction and message classification | Unit tests | Transcript text fixtures for aviation and marine examples | Prove callsign/vessel extraction, urgency rules, evidence, and confidence. |
| Storage and migrations | Unit and integration tests | Temporary SQLite databases | Prove schema creation, migrations, queries, and persistence across restart. |
| Web API and SSE | API integration tests | Fake/replay service events | Prove JSON/event contracts consumed by the browser. |
| Browser UI behavior | Browser/UI tests | Replay backend or static fixture API responses | Prove small-screen layout, active states, alert treatment, detail sheet, and transcript review. |
| Live RTL-SDR Blog V3 path | Manual hardware verification plus automated adjacent tests | Real RTL-SDR Blog V3 capture | Prove hardware setup, GNU Radio runtime, gain/PPM/bias tee behavior, and end-to-end live monitoring. |

Fixture rules:

- Keep small text/profile/transcript fixtures in the repo.
- Keep short audio fixtures in the repo only when their size is reasonable.
- When RTL-SDR hardware is available, capture short real-world IQ/radio-stream and demodulated audio fixtures from the antenna to seed replay tests.
- Keep larger IQ/radio stream captures outside normal test runs unless they are tiny enough for the repo; document where they live and how to run the replay tests.
- CI should default to tests that do not require SDR hardware, OpenAI credentials, or large local fixture downloads.
- Hardware and paid-provider tests should be opt-in, clearly named, and safe to skip in normal development.

Every milestone should preserve:

```sh
python3 scripts/dev.py setup
python3 scripts/dev.py test
python3 scripts/dev.py compile
git diff --check
```

Add tests for:

- profile loading and validation.
- capture group fit math.
- radio engine interface behavior.
- replay backend.
- detector edge cases.
- segment state transitions.
- storage migrations.
- transcription provider success/failure.
- SSE event serialization.
- participant and message classification rules.
- API compatibility.

### Documentation

Keep documentation current as implementation changes:

- `README.md` for quick start.
- `VERSION.md` for every version.
- `documentation/folder-structure.md` when folders change.
- ADRs for direction changes.
- radio setup documentation before hardware-dependent releases.

### Runtime Safety

The app should:

- stay receive-only.
- keep bias tee off by default.
- explain one-SDR bandwidth limits.
- avoid paid API use unless explicitly configured.
- keep API keys on the backend only.
- avoid browser access to OpenAI credentials.
- make uncertainty visible in classifications.

## Open Questions

- Should we lower Python support to `>=3.12` if GNU Radio bindings make Python `3.13` awkward?
- Should the first UI implementation stay plain static JavaScript, or introduce a small frontend build tool after the Watchboard becomes more complex?
- How much manual editing should transcript review support before `1.0.0`?

## Recommended Next Step

Start next with profile/runtime selection controls in the Setup UI, or with a short manual live-hardware verification pass if the RTL-SDR is visible to `rtl_test`.

Demodulated WAV fixture replay, marine NFM live demodulation, and radio-stream fixture capture/validation are now available. The next largest product risks are making runtime/profile selection easier and turning captured IQ fixtures into opt-in channelization/demodulation replay tests.
