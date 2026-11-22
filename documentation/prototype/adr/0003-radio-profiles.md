# ADR 0003: Use Radio Profiles Instead Of Hard-Coded Channels

> **Prototype archive.** This page describes the earlier Python prototype. Its commands, paths, release numbers, and plans apply to that implementation. For the Rust application, see the [current documentation](../../README.md).

## Status

Accepted

## Context

Aviation and marine monitoring use different frequencies, labels, modulation types, and vocabulary. Hard-coding IAD channels in Python makes the app difficult to reuse and hides important radio constraints.

## Decision

Move domain-specific channel configuration into profile files. A profile defines:

- Domain: aviation, marine, or custom.
- Channels and labels.
- Frequency in Hz.
- Modulation.
- Capture group.
- Detector settings.
- Transcription prompt or vocabulary hint.

## Consequences

- IAD airband becomes one profile.
- Marine VHF can be added without changing app code.
- The UI can offer setup and profile selection.
- Tests can validate profile parsing independently from SDR hardware.
