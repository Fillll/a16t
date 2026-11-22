# A16T

A16T is a local, receive-only radio monitor for RTL-SDR. Choose an aviation AM or marine narrow-FM profile, listen to individual channels in the browser, and review a compact recording of each detected transmission. The receiver keeps running when the browser closes.

[Listen to 15 seconds of KHB49 weather radio](examples/weather-broadcast.opus), received off air with an RTL-SDR and demodulated by A16T. The excerpt includes static and a spoken tide forecast. [Capture settings and checksum](examples/weather-broadcast.json)

## Try it without a radio

Install Rust 1.89 or newer, Python 3.9 or newer, and FFmpeg with the libopus encoder. Run these commands from this checkout.

```sh
cargo run --locked -- --mode replay
```

Open [the Watchboard](http://127.0.0.1:8787). Over 6.5 seconds the built-in replay sends one tone burst followed by a click. The burst should yield one playable clip on East Bay Channel 14. The isolated click should yield none. The Watchboard stays open when the replay finishes. Screen updates and clip playback require no third-party servers.

To run the same check without a browser and exit after the archive finishes:

```sh
cargo run --locked -- --mode replay --once
```

## Connect an RTL-SDR

Live reception also requires GNU Radio 3.10, its Soapy source, and the SoapyRTLSDR device module. Use the Python interpreter that can import these modules. Attach a suitable antenna. Close any other application using the dongle.

```sh
python3 -c 'from gnuradio import gr, soapy; print(gr.version())'
SoapySDRUtil --find="driver=rtlsdr"
cargo run --release --locked -- --mode live --profile profiles/eastbay-marine.json --python python3
```

On the Watchboard, select a channel and press **Listen live**. The meter, detection threshold, and time of the latest samples help distinguish a quiet channel from an interrupted receiver. Use a handheld on the same channel as a second receiver. A Bay Area weather profile is included for a continuous speech check:

```sh
cargo run --release --locked -- --mode live --profile profiles/noaa-weather.json --duration 20 --once
```

The archive in `runtime_data/` holds 20 kbit/s Opus audio, SQLite metadata and optional transcripts. The default audio retention budget is 512 MiB. Use `--keep-wav` to retain original PCM for debugging. Transcription is disabled by default. [Storage and transcription](documentation/storage.md) · [Live radio and IQ replay](documentation/receiver.md)

## Develop

```sh
cargo test --locked
cargo build --locked
python3 -m unittest discover -s receiver/tests -v
python3 -m unittest discover -s tests -v
```

The current [documentation index](documentation/README.md) covers architecture, operation, and the prototype reference. [Contributor and agent instructions](AGENTS.md) describe the repository workflow.
