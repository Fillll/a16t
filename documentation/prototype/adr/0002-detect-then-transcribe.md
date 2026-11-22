# ADR 0002: Detect Locally Before Paid Transcription

> **Prototype archive.** This page describes the earlier Python prototype. Its commands, paths, release numbers, and plans apply to that implementation. For the Rust application, see the [current documentation](../../README.md).

## Status

Accepted

## Context

The app needs speech-to-text, but streaming every monitored frequency to a paid API would waste money and create unnecessary processing load. Radio channels are idle most of the time, and push-to-talk conversations are naturally segmentable.

The user also wants the first half-second of speech preserved when activity begins.

## Decision

The app will detect radio activity locally before sending audio to any speech-to-text provider.

Each channel will maintain a pre-roll ring buffer. When activity crosses the detector threshold, the recorder starts the segment with buffered audio from before the trigger. The default pre-roll should be at least `0.5s`; the recommended starting value is `0.75s`.

For the first version, the app will send completed bounded clips to transcription. Realtime transcription can be added later as a mode that starts only after local detection.

## Consequences

- Idle radio audio does not consume transcription budget.
- Transcript text arrives after a segment ends in the MVP.
- The UI must separate live radio activity from transcript availability.
- Realtime transcript deltas require extra session lifecycle work later.
