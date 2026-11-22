# ADR 0004: Keep One Small App With Clear Internal Boundaries

> **Prototype archive.** This page describes the earlier Python prototype. Its commands, paths, release numbers, and plans apply to that implementation. For the Rust application, see the [current documentation](../../README.md).

## Status

Accepted

## Context

The app should stay small. Splitting everything into separate services would add deployment friction before the product shape is proven. At the same time, the current prototype couples radio capture, detection, transcription, storage, and UI state too tightly.

## Decision

Keep one local app process for now, but separate internal modules with explicit boundaries:

- Radio engine
- Activity detection
- Segment recording
- Transcription providers
- Speaker and message intelligence
- Storage
- Web API, event stream, and browser UI

Each boundary should have:

- A clear owner responsibility.
- A small interface that other modules call.
- Typed data objects or dictionaries at the boundary.
- Unit tests that can run without radio hardware or paid APIs.
- At least one fake, replay, or null implementation when hardware or network access would otherwise be required.

Boundaries should be directional:

```text
radio -> detection -> recording -> transcription/intelligence -> storage -> web
```

Cross-cutting configuration and events can be shared through explicit models, but lower-level modules should not import higher-level modules. For example, the radio engine should not import FastAPI, SQLite storage, OpenAI clients, or UI code.

Boundaries are not permission to create a separate service for everything. A16T should stay one small app until a module has a real reason to become a worker or external process.

## Consequences

- Local setup stays simple.
- Tests can target boundaries without hardware.
- GNU Radio remains replaceable.
- OpenAI remains replaceable.
- Web UI development can proceed against fake/replay radio events.
- Paid transcription can be disabled without changing radio or detection code.
- The app can later split workers out if realtime transcription, multiple SDRs, or heavy DSP require it.
- There is some up-front interface design cost, but that is better than letting hardware, paid APIs, and UI state leak into every module.
