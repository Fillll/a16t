# Version history

## Unreleased

The Marine VHF Watchboard and Timeline show Channel 16 between 15 and 17, with a red label.

New airband profiles cover SFO Tower and Oakland North Tower together, and ground control at both airports. The Oakland airband profile adds the published 124.900 MHz tower frequency and corrects the 125.350 MHz approach label to East.

The Watchboard now includes a rolling one-hour timeline for every channel in the active profile, with live activity and playback of archived transmissions.

The compact timeline uses a thin line for each channel and colored drops for transmission types. Hover or keyboard focus reveals the call details and transcript preview. Priority types come from recognized signals in the transcript, and routine channel-based labels identify their source.

The full Marine VHF profile processes all 48 channels simultaneously with a lower intermediate sample rate and batched GNU Radio scheduling for continuous reception.

## 0.1.0

First public implementation. Rust detects and archives transmissions from a Python GNU Radio receiver, with repeatable replay, live listening, AM and narrow-FM reception, session provenance, and an independent browser Watchboard. The normal archive uses compact Opus, supports optional clip transcription, and recovers interrupted local work.
