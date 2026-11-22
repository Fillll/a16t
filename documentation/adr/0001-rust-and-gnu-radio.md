# ADR 0001. Rust application with a GNU Radio receiver

**Accepted.** Use Rust for the continuous monitor, activity detector, recording lifecycle and local API. Keep GNU Radio flowgraph configuration in Python to support rapid tuning and comparison of demodulators. Native GNU Radio blocks handle filtering and demodulation. A framed audio stream separates its Python environment from the Rust process.

Keep a browser Watchboard as the first client. A future native client can use the same local API. Keep one local SQLite archive and record on activity. Feed optional transcription the original finished PCM. Store compact Ogg Opus for ordinary playback and keep originals on request.

The alternatives reviewed were extending the Python proof of concept, writing the full receiver in Rust, and a GNU Radio C++ application. The chosen boundary preserves a familiar receiver while letting detection and archiving evolve independently. Deterministic audio, generated raw radio signals and real reception each validate a different part of the system.
