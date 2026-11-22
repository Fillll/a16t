# Architecture

An A16T process runs a Rust application and starts one Python receiver subprocess. The browser is optional. Closing every browser tab leaves capture and recording active. Each process holds one archive directory lock.

| Location | Responsibility |
| --- | --- |
| `profiles/` | Capture windows, channel identities, frequencies and modulation |
| `receiver/` | RTL-SDR, GNU Radio AM and NFM demodulation, binary sample framing, deterministic replay |
| `src/monitor.rs` | Validate frame continuity, maintain channel health and hand finished recordings to the writer |
| `src/detection.rs` | Detect activity in fixed 10 ms windows of 16 kHz audio, retain pre-roll and hang time |
| `src/archive.rs`, `src/archive/` | Durable capture sessions, audio encoding, transcription, crash recovery and disk budget |
| `src/web.rs`, `web/` | Local HTTP, event stream, live PCM listening and the browser Watchboard |

Rust receives channel-indexed frames with a sample counter. A connection to a single source supplies a common session time origin. Each clip stores its profile, source and channel. An index gap ends the current region and increments the dropped-sample counter. The pre-roll and hang time pad the recorded audio. Only above-threshold audio windows count toward the minimum activity duration.

A bounded recording queue separates file writes from capture. When it fills, the monitor reports the affected recording and increments its drop count. Live monitoring has a separate short buffer for each listener. SQLite job state survives restarts. See the [archive](storage.md) for the distinction between local retries and an ambiguous hosted transcription result.

## HTTP interface

| Request | Result |
| --- | --- |
| `GET /` | Static Watchboard |
| `GET /api/state` | Active profile, source, receiver state, per-channel levels, latest sample times, confirmed live intervals, drop counts, archive errors, and recent recordings |
| `GET /api/timeline` | Profile, source, rolling-hour bounds (`start_ms`, `end_ms`) and every archived transmission overlapping those bounds on a configured channel and frequency |
| `GET /events` | Server-Sent Events. Each named `state` event contains a complete snapshot, including the initial event. |
| `GET /api/listen/{channel}` | Live signed 16-bit mono PCM at 16 kHz in a streaming WAV container |
| `GET /api/clips/{id}/audio` | Playable archived audio, or HTTP 404 when unavailable or expired |

The default bind is loopback. This local HTTP interface includes recorded audio and transcripts and has no authentication. The core library has no dependency on the Watchboard lifecycle. A native client can use this API.

Timeline timestamps are Unix milliseconds with an exclusive end. Each archived transmission carries its clip ID, channel ID, frequency in Hz, original start and end, and archive status. The query includes earlier sessions in this archive that match the running source, channel ID and frequency, even across profile changes. Expired audio retains its interval. Clients clip bars to the requested window. The channel fields `active_since_ms` and `active_until_ms` describe confirmed audio still being captured and are null otherwise. They use the same sample clock as the archived clip.
