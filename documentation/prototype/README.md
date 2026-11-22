# Prototype documentation archive

> **Prototype archive.** This page describes the earlier Python prototype. Its commands, paths, release numbers, and plans apply to that implementation. For the Rust application, see the [current documentation](../README.md).

## Knowledge Pages

1. [Product brief](product-brief.md)
2. [Architecture](architecture.md)
3. [Folder structure](folder-structure.md)
4. [Implementation plan to 1.0.0](implementation-plan-1.0.md)
5. [Runtime preflight and local transcription setup](runtime-preflight.md)
6. [Replay fixtures](replay-fixtures.md)
7. [Demo mode](demo-mode.md)
8. [Radio-stream fixtures](radio-stream-fixtures.md)
9. [Live hardware verification and East Bay profiles](live-hardware-verification.md)
10. [UI concepts](ui-concepts.md)
11. [Small-screen UI strategy](small-screen-ui.md)
12. [Technology review](technology-review.md)
13. [Speaker and message intelligence](speaker-message-intelligence.md)
14. [Current state review](current-state-review.md)

## Architecture Decisions

- [ADR 0001: Repository documentation and product scope](adr/0001-docs-first-reset.md)
- [ADR 0002: Detect activity before transcription](adr/0002-detect-then-transcribe.md)
- [ADR 0003: Profile-based radio configuration](adr/0003-radio-profiles.md)
- [ADR 0004: Small app and modular boundaries](adr/0004-small-app-modular-boundaries.md)
- [ADR 0005: Documentation folder name](adr/0005-use-documentation-folder.md)

## Working Name

The current working name is **A16T**: a small local app that watches selected radio channels, shows which ones are active, records detected conversations, and transcribes only those conversations.

## Core Principle

The app should not stream every monitored frequency to paid transcription. It should detect radio activity locally, preserve a short pre-roll buffer, and only send bounded conversation audio to a transcription backend after a real transmission is detected.
