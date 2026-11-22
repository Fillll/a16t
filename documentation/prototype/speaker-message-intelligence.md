# Speaker And Message Intelligence

> **Prototype archive.** This page describes the earlier Python prototype. Its commands, paths, release numbers, and plans apply to that implementation. For the Rust application, see the [current documentation](../README.md).

## Goal

A16T should eventually show not just that a frequency is active, but who appears to be talking and what kind of message is being sent.

For aviation and marine radio, "who is speaking" should start as radio participant identification, not biometric person recognition. Aircraft, vessels, controllers, pilots, and stations usually identify themselves with callsigns, tail numbers, vessel names, or station names. That gives the app a useful identity signal without needing to recognize a human voice.

Since `0.8.0`, A16T has deterministic transcript rules under `src/a16t/intelligence/` for first-pass participant extraction, message classification, priority, confidence, and evidence. Later work should add turn linking, editable metadata, enrichment, and optional experiments only when the local monitor needs them.

## Desired User Experience

In live transcription and transcript review, the user should see turns like:

```text
United 123: Dulles Tower, United one twenty-three, holding short runway one left.
Dulles Tower: United one twenty-three, cleared for takeoff runway one left.
```

On higher-level views, each transmission should show:

- Channel or frequency.
- Most likely participant.
- Role, when known: aircraft, vessel, tower, ground, approach, coast guard, marina, unknown.
- Message type.
- Urgency.
- Confidence.

## Option 1: Transcript Entity Extraction

Extract participant identity from transcript text.

How it works:

- Run speech-to-text for a detected transmission.
- Parse the transcript for callsigns, tail numbers, vessel names, and station names.
- Use profile-specific grammar for aviation and marine phrases.
- Store the extracted participant with a confidence score and supporting transcript span.

Examples:

- `United one twenty-three` -> airline callsign `United 123`.
- `November one two three alpha bravo` -> tail number `N123AB`.
- `Dulles Tower` -> station role `tower`.
- `motor vessel Aurora` -> vessel name `Aurora`.

Pros:

- Cheapest and simplest.
- No biometric voice processing.
- Works well when radio participants self-identify.
- Easy to correct manually and improve over time.

Cons:

- Depends on transcription accuracy.
- Participants may omit callsigns in follow-up turns.
- Callsign formats vary by domain and country.

Recommendation:

Use this first.

## Option 2: Turn-Based Role Assignment

Use radio turn structure and domain rules to infer roles across a conversation.

How it works:

- Treat each push-to-talk segment as one turn.
- Link adjacent turns on the same channel into a conversation window.
- Use text patterns to classify turns as aircraft/vessel/station/controller.
- Carry the most recent participant identity forward when a reply omits the full name.

Pros:

- Matches how half-duplex radio conversations usually work.
- Helps show "one person speaking, another responding" in the UI.
- Does not require voice recognition.

Cons:

- Can confuse overlapping conversations on busy channels.
- Needs careful timeout and channel-specific rules.
- Confidence must be visible when identity is inferred rather than explicit.

Recommendation:

Add after transcript entity extraction.

## Option 3: Domain Enrichment

Join extracted identities against outside context.

For aviation:

- Airline callsign tables.
- Tail number formats.
- Nearby ADS-B aircraft, if the user provides a local feed.
- Airport-specific callsigns and facility names.

For marine:

- AIS vessel names, if available.
- MMSI or vessel registries, where legally and practically available.
- Local coast guard, marina, harbor, or vessel traffic service station names.

Pros:

- Can improve accuracy and display names.
- Enables stable colors by airline, operator, aircraft, vessel, or station.
- Helps resolve ambiguous transcript text.

Cons:

- Adds data dependencies.
- Some datasets may be incomplete, delayed, licensed, or jurisdiction-specific.
- Correlation can be wrong, so evidence and confidence matter.

Recommendation:

Add as an optional enhancement after the core app is useful.

## Option 4: Audio Speaker Diarization

Use audio models to split clips into speaker-like groups.

How it works:

- Run a diarization model on recorded audio.
- Label segments as `Speaker A`, `Speaker B`, and so on.
- Combine diarization with transcript text and callsign extraction.

Pros:

- Useful if one clip contains multiple human voices.
- Can help when text does not include a callsign.

Cons:

- Radio audio is narrowband, noisy, compressed, and distorted.
- Push-to-talk already separates many turns into separate transmissions.
- Diarization does not know that `Speaker A` is `United 123` without extra logic.
- It adds compute and model complexity.

Recommendation:

Treat as experimental. It may help transcript review, but it should not be the first identity feature.

## Option 5: Voice Matching Or Enrollment

Match audio to previously enrolled voices.

Pros:

- Can identify recurring human speakers when callsigns are absent.

Cons:

- This is biometric identification and raises privacy, consent, and legal concerns.
- It may perform poorly on radio audio.
- It is unnecessary for the first useful version because callsigns and vessel names are the primary radio identity.

Recommendation:

Do not include in the MVP or early releases. Revisit only with explicit consent, local-only processing, and a clear need.

## Message Type Classification

The app should classify each transmission by purpose and urgency.

Initial taxonomy:

- Distress: `Mayday`, declared emergency, imminent danger.
- Urgency: `Pan-pan`, medical issue, equipment failure, fuel issue, safety concern.
- Safety broadcast: `Securite`, navigation hazard, traffic advisory.
- Weather: ATIS, AWOS, marine weather, wind, visibility, altimeter, sea state.
- Clearance or instruction: takeoff, landing, taxi, heading, altitude, route, docking, movement instructions.
- Readback or acknowledgement.
- Position report.
- Routine coordination.
- Unknown.

Implementation options:

- Fast keyword rules for high-priority terms.
- Structured classifier over transcript text for normal categories.
- Realtime partial-transcript monitoring for emergency words.
- Manual correction in transcript review is now available for participant label/kind and message type/priority. Later versions can use those corrections to improve prompts and rules.

Distress and urgency should be conservative. It is better to show "possible emergency" with confidence than to silently miss an important transmission.

## Color Coding

The UI should support multiple color modes:

- By frequency: stable channel colors.
- By participant: stable aircraft, vessel, airline, operator, or station colors.
- By message type: red for distress, amber for urgency, grey for weather or routine information, and neutral colors for unknown.
- Hybrid: channel color as the base, participant badge color, and message-type alert overlay.

Emergency and distress classifications should override the selected color mode. A red treatment, strong border, and optional pulse are appropriate, but animation must respect reduced-motion accessibility settings.

## Data Shape

Suggested fields on a transmission:

```json
{
  "participant_id": "participant-united-123",
  "participant_display_name": "United 123",
  "participant_kind": "aircraft",
  "participant_confidence": 0.86,
  "participant_evidence": "United one twenty-three",
  "message_type": "routine",
  "message_urgency": "normal",
  "message_confidence": 0.74,
  "message_evidence": "holding short runway one left"
}
```

Suggested participant record:

```json
{
  "id": "participant-united-123",
  "display_name": "United 123",
  "kind": "aircraft",
  "aliases": ["UAL123", "United one twenty-three"],
  "operator": "United",
  "color": "#1971c2",
  "first_seen_at": "2026-06-13T21:20:00Z",
  "last_seen_at": "2026-06-13T21:27:00Z"
}
```

## Recommended Release Path

1. Store transcript text, channel, timing, and clip metadata. Done in the storage/transcription milestones.
2. Add message type classification with high-priority keyword alerts. Done in `0.8.0`.
3. Add transcript-based participant extraction. Done in `0.8.0`.
4. Add turn linking so replies can inherit the likely participant.
5. Add UI color modes and editable participant/message metadata.
6. Add optional domain enrichment from ADS-B or AIS sources.
7. Experiment with audio diarization only if transcript-based identity is not enough.
