# Recording archive

Each run opens a private data directory, takes an exclusive file lock, and creates a capture session. SQLite keeps the profile and source for each session. Every clip has a stable numeric ID, channel, frequency, timestamp, sample count and session. Files use these IDs so changes to channel labels or profile names do not invalidate playback links.

The capture worker writes mono signed 16-bit PCM at 16 kHz to a temporary WAV, flushes it to disk, and atomically publishes it. SQLite records the expected sample count before the write. On restart A16T checks the WAV header and length, promotes completed temporary files, and resumes queued work. A partial recording stays visible as incomplete with no playable file. An instance pointed at an archive that is already in use exits.

The archive worker uses FFmpeg with libopus to produce an Ogg Opus file targeting 20 kbit/s in voice mode. Playback is available from the original WAV while encoding is pending. Debug WAV retention keeps the original alongside Opus. If encoding fails the original remains playable, the error appears in clip metadata, and restarting A16T retries the encode. Capture continues independently of the worker.

## Transcription

Transcription is off by default. Configure a provider before launching A16T.

| Provider | Configuration |
| --- | --- |
| None | Set `A16T_TRANSCRIPTION_PROVIDER=none` to explicitly disable transcription. |
| Local | Set `A16T_WHISPER_MODEL` to a local whisper.cpp model file. A16T selects the local provider when this variable is set. The executable defaults to `whisper-cli` on PATH. Override with `A16T_WHISPER_BIN`. |
| OpenAI | Set `A16T_TRANSCRIPTION_PROVIDER=openai` and supply `A16T_OPENAI_API_KEY` or `OPENAI_API_KEY` in the environment. The model defaults to `gpt-4o-transcribe` and can be selected with `A16T_OPENAI_MODEL`. The host needs curl. This provider can incur charges. |

Both providers receive the completed original WAV. The cloud provider limits each file to 25 MB, uses a fixed HTTPS endpoint, and passes authorization to curl through standard input. The API key is never saved to SQLite. A queued job records its provider and model at capture time. If the provider has changed after restart, the job pauses until the original provider is enabled again.

A16T commits a marker before issuing any cloud request. An interruption before the response is committed, including one after the provider has received the audio, leaves the request `uncertain`. Review the provider's records before deciding whether another request is appropriate. The application makes one automatic submission per job. Successful transcripts remain in SQLite.

## Retention

Encoding preserves the original WAV for paused, failed, or uncertain transcription jobs. Debug mode also preserves originals for successful or disabled transcription. The byte budget covers all archived audio, including these originals and failed encodes. When expiration reaches a clip, both the WAV and Opus are removed. Its history, transcript, and transcription outcome remain in SQLite. Expiration proceeds oldest first by capture time; a zero-byte budget expires all completed clip audio. A16T records expiration before deleting files so an interrupted cleanup finishes at next startup.

Queued recordings, SQLite metadata, and temporary encoding files need additional working space. Keep the private data directory outside source control.
