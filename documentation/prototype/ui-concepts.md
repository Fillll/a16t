# UI Concepts

> **Prototype archive.** This page describes the earlier Python prototype. Its commands, paths, release numbers, and plans apply to that implementation. For the Rust application, see the [current documentation](../README.md).

## Design Direction

The UI should feel like a small monitoring instrument, not a dashboard template. It should be calm, readable from a few feet away, and clear about what is live right now.

The first target is a small laptop, so every view should be compact-first. A large desktop layout can add comfort, but it must not be the design source. For detailed responsive behavior, see [small-screen-ui.md](small-screen-ui.md).

Visual priorities:

- Active frequency is obvious within 200 ms of the backend event.
- Idle frequencies stay visible but quiet.
- Transcript status is distinct from radio activity.
- Participant identity and message type are visible without crowding the transcript.
- Emergency and distress classifications override decorative color choices.
- The user can review recent conversations without losing live awareness.

## UI 1: Watchboard

Purpose: live monitoring.

Layout:

- One tile per channel.
- Large frequency and channel label.
- Signal level meter.
- Activity state: `Idle`, `Detecting`, `Recording`, `Transcribing`, `Transcript ready`.
- Elapsed time for current transmission.
- Current or most likely participant, such as `United 123`, `N123AB`, `Dulles Tower`, or a vessel name.
- Message badge, such as `Routine`, `Weather`, `Safety`, or `Distress`.
- Last transcript preview.

Best for:

- A laptop on a desk near the radio.
- Seeing which frequency is active right now.

## UI 2: Timeline

Purpose: answer "what happened over the last few hours?"

Layout:

- One horizontal lane per frequency.
- Transmission blocks positioned by time.
- Block color can indicate channel, participant, airline/operator, or message type.
- Block outline or icon indicates transcript status.
- Emergency and distress blocks use a red alert treatment regardless of the selected color mode.
- Click opens audio and transcript.

Best for:

- Finding busy periods.
- Reviewing missed conversations.

## UI 3: Transcript Review

Purpose: read and correct transcripts.

Layout:

- Left column: searchable transmission list.
- Main area: transcript, audio player, waveform, metadata.
- Speaker turns shown as alternating participant rows when identity is known.
- Extracted callsigns, vessel names, and message type are editable.
- Tags or corrections can be added later.

Best for:

- Improving domain prompts.
- Exporting useful clips.
- Comparing transcription providers.

## UI 4: Setup

Purpose: configure the small app without editing Python.

Layout:

- Profile selector: aviation, marine, custom.
- Channel editor: label, frequency, modulation, capture group.
- SDR settings: device, center frequency, sample rate, gain, PPM.
- Detection settings: threshold, pre-roll, hang time.
- Transcription settings: provider, model, mode, budget guardrail.
- Intelligence settings: participant extraction, message classification, alert categories, and color mode.

Best for:

- Moving from IAD airband to another airport.
- Switching from aviation to marine VHF.

## State Model For UI

The UI should render channel state from backend events:

```json
{
  "channel_id": "iad-tower-120100",
  "label": "Tower 120.100",
  "frequency_hz": 120100000,
  "activity": "recording",
  "level": 0.18,
  "current_transmission_id": 42,
  "started_at": "2026-06-13T21:20:00Z",
  "transcript_status": "transcribing",
  "participant": {
    "display_name": "United 123",
    "kind": "aircraft",
    "confidence": 0.86
  },
  "message_type": {
    "label": "Routine",
    "urgency": "normal",
    "confidence": 0.74
  }
}
```

The UI must not assume that `activity = recording` means transcript text already exists.

## Color Modes

The UI should support more than one color strategy:

- Frequency mode: stable color per monitored channel.
- Participant mode: stable color per aircraft, vessel, airline, operator, or station.
- Message type mode: color by purpose, such as emergency, weather, clearance, or routine.
- Hybrid mode: channel color as the base, with participant badges and message-type alert overlays.

Critical alerts must remain recognizable in every mode. For example, distress traffic should use red with a strong alert treatment. Motion should respect reduced-motion settings, so a pulse or flashing effect must have an accessible non-animated fallback.
