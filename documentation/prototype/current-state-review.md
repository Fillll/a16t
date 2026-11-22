# Current State Review

> **Prototype archive.** This page describes the earlier Python prototype. Its commands, paths, release numbers, and plans apply to that implementation. For the Rust application, see the [current documentation](../README.md).

This repo already has useful prototype work, but it is still shaped around one personal IAD proof of concept. That is fine for learning, but it should not become the permanent architecture.

## What Is Good

- The detector is mostly isolated and testable.
- The source package now uses a boundary-oriented `src/a16t/` layout.
- IAD starter and expanded marine VHF configurations now live in profile files.
- Radio capture is behind a `RadioEngine` boundary with `no-radio`, `replay`, and `gnuradio` backends.
- Replay can now emit synthetic activity or demodulated WAV fixtures through the same radio boundary.
- Demo mode can seed a synthetic busy-day 24-hour Treasure Island / San Francisco Bay maritime log into a separate local database for no-hardware UI review.
- Short RTL-SDR IQ/radio-stream fixture capture is now available through a developer command.
- Radio-stream fixture validation now checks pre-demodulation IQ capture manifests against profiles and fixture data files.
- The GNU Radio live backend now supports aviation AM and marine VHF NFM profile channels.
- Detected transmissions now move through explicit lifecycle states.
- The `recording` boundary owns durable WAV clip creation and queue handoff.
- SQLite now stores lifecycle timestamps and app events.
- Transcription now runs behind explicit `null`, `openai`, and optional local provider modes.
- OpenAI transcription uses bounded completed clips and refuses oversized uploads before network work.
- Transmission records now store transcription provider and model metadata.
- The browser consumes a Server-Sent Events stream through `GET /events`.
- The primary UI is now a compact Watchboard built for small laptop and phone viewports.
- The Watchboard can switch to a dense numbered channel band for larger profiles such as Marine VHF.
- The `intelligence` boundary now extracts first-pass participants and message categories from completed transcripts.
- Emergency and urgent message priorities now receive Watchboard alert treatment.
- The browser now has a Review mode for filtering recent transmissions without hiding the Watchboard.
- The selected transmission detail now supports manual participant and message metadata corrections.
- Runtime preflight now explains profile, path, GNU Radio, RTL-SDR tools, optional hardware, bias tee, and transcription readiness before live capture.
- The browser now has a Setup mode for runtime status, paths, diagnostics checks, and recent app events.
- SQLite storage is simple and appropriate for the first version.
- The API surface is small and includes review-oriented transmission filtering.
- Clips are saved as bounded WAV files, which matches the cost-control goal.
- The legacy pipeline and provisioning files have been removed from the tracked repo.
- `--no-radio` can now start without importing GNU Radio.

## What Is Suboptimal

- Profile selection exists at startup, and Setup can show runtime status, but there is not yet a profile-changing UI.
- GNU Radio live support is still limited to one capture group and the currently supported AM/NFM demodulation paths.
- Radio-stream fixtures can be captured and validated, but not yet replayed through channelization and demodulation.
- Manual correction is limited to participant/message metadata; transcript text editing and correction-assisted rule tuning are still later work.
- Transcription defaults are no-cost `null`, so real transcript generation still requires explicit configuration.
- Participant extraction and message classification are deterministic first-pass rules, not conversation linking or voice diarization.
- Hardware dependencies are not reproducible from `pyproject.toml`, and that remains correct for GNU Radio, but they now have an explicit preflight path.
- `requires-python >=3.13` is good for modern app code but may be awkward for system-provided SDR Python bindings.
- `jinja2`, direct `pydantic`, and `pytest-asyncio` have been removed or deferred until the app actually needs them.
- The optional local transcription extra still reflects the old local experiment; it may deserve a clearer `local-transcription` extra later.
- Tests cover the detector, profile loading, radio backend selection, GNU Radio AM/NFM modulation routing, radio-stream fixture capture/validation, runtime preflight behavior, runtime diagnostics API, synthetic and fixture replay, segment lifecycle, storage migration, API basics, review filtering, event streaming, transcription provider behavior, and intelligence rules.
- Demo tests cover the Treasure Island scenario high-density channel mix, peak-hour volume, recent short-window activity, non-marine profile rejection, Channel 70 voice exclusion, and API metadata.

## Recommended Reset

Do not throw away the code. Instead, keep the working pieces and redraw the boundaries:

- Keep the detector under the `detection` boundary.
- Keep SQLite, but continue evolving the event and transmission schema explicitly.
- Keep FastAPI and continue evolving the event stream for live UI state.
- Keep GNU Radio as one radio engine implementation, not as something imported by app code in every mode.
- Keep expanding replay/fake coverage so UI and tests do not depend on live hardware.
- Keep expanding profile validation as radio backends grow.
- Keep transcription provider decisions isolated behind the provider interface.
- Treat the current IAD file as a starter profile and the marine file as the first broader lower-band profile.

## Next Milestone

The next code milestone should be:

1. Add profile/runtime selection controls.
2. Add opt-in IQ-to-channel-audio replay once a useful radio-stream fixture is captured.
3. Add transcript text editing or correction-assisted intelligence improvements if review workflows need them.
4. Add longer-session live verification notes once real hardware runs have been observed.

That gives a small but real app without pretending the final radio engine is solved.
