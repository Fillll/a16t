# Product Brief

> **Prototype archive.** This page describes the earlier Python prototype. Its commands, paths, release numbers, and plans apply to that implementation. For the Rust application, see the [current documentation](../README.md).

## Goal

Build a small local web app for monitoring multiple radio channels at the same time, with a clear visual indication of which channel is active and a transcript for each detected conversation.

The first useful version should feel like a quiet monitoring console:

- Choose an airband or marine profile.
- See all configured frequencies at once.
- Immediately see when someone is transmitting.
- Save one clip per detected conversation.
- Transcribe only detected conversations.
- Review recent clips, transcripts, timing, and channel activity.
- Fit comfortably on a small laptop screen without needing a large desktop monitor.

## Primary Users

- Someone living near an airport who wants to monitor local airband tower, ground, approach, or departure channels.
- Someone near a coast, marina, or harbor who wants to monitor selected marine VHF channels.
- A radio hobbyist who wants a small local app instead of a pile of SDR scripts.

## MVP Scope

- One local browser UI.
- One local backend process.
- One configured profile at a time.
- Multiple frequencies monitored at once when they fit inside the SDR capture bandwidth.
- Local activity detection using demodulated channel audio.
- Per-channel pre-roll buffer, defaulting to at least 0.5 seconds.
- One WAV clip per detected transmission.
- Request-based speech-to-text after a transmission ends.
- Storage for clips, transcript text, and metadata.

## Later Scope

- Multiple UI modes: compact watchboard, timeline, transcript review, and setup/profile editor.
- Multiple SDR devices or multiple capture windows.
- Realtime transcription mode that streams audio only while a channel is active.
- Participant identification from callsigns, tail numbers, vessel names, and radio roles.
- Message classification for emergency, safety, weather, clearance, routine, and unknown traffic.
- Multiple visual color modes, such as coloring by frequency, participant, airline/operator, or message type.
- Per-profile vocabulary hints for aviation, marine, or custom radio domains.
- Export, search, tagging, correction, and confidence review.

## Non-Goals

- Transmitting on any frequency.
- Monitoring encrypted, private, or prohibited communications.
- Perfect coverage of all airport or marine channels with one SDR.
- Always-on paid transcription.
- Replacing official aviation, marine, or emergency information sources.

## Product Constraints

- The primary UI target is a small laptop. Tablet and phone layouts must be planned from the beginning, not treated as afterthoughts.
- Radio receive legality depends on jurisdiction and use. The app should be receive-only and should make configuration explicit.
- One SDR can only monitor channels that fit within its usable instantaneous bandwidth. Other channels require another SDR, another capture window, or time-sharing.
- Aviation airband commonly uses AM audio; marine VHF commonly uses narrow FM. The app must treat modulation as profile configuration, not a hard-coded assumption.
- The UI must show detection and transcription as separate states. A channel can be active before transcript text exists.
