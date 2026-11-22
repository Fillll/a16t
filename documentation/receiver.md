# Receiver and replay

One tuner supplies one capture window. The receiver extracts each profile channel inside that window, applies RF squelch, demodulates aviation AM or marine narrow FM, and writes mono 16 kHz audio frames. Rust owns activity detection and recording. The [East Bay marine](../profiles/eastbay-marine.json) and [Oakland airband](../profiles/oak-airband.json) profiles are small enough to use for initial bring-up. The larger [marine profile](../profiles/marine-vhf.json) includes digital Channel 70 for visibility; A16T does not decode DSC.

To monitor all 48 Marine VHF channels simultaneously, run the following command with the Python interpreter that provides GNU Radio. Open **Timeline** on the Watchboard to see detections across the profile.

```sh
cargo run --release --locked -- --mode live --profile profiles/marine-vhf.json --python python3
```

The full marine profile uses one 2.4 MHz RF capture. Each channel filter decimates to 32 kHz before FM demodulation and 16 kHz audio output. For continuous sessions of 16 or more channels, GNU Radio schedules the channel filters and PCM sinks in multiples of 256 audio samples (16 ms). These larger batches reduce scheduler overhead. To check real-time operation, time the PCM payload from a few live listening endpoints. Each should deliver about 32,000 bytes per second after its 44-byte WAV header. A fresh last-sample timestamp alone can also occur when the radio is losing input.

## San Francisco and Oakland airband

Start with the shared tower profile to hear SFO Tower and Oakland North Tower simultaneously. Oakland South Tower uses 127.200 MHz, 6.700 MHz above SFO Tower. Hearing both at once would require more than the 2.4 MHz window used by these RTL-SDR profiles. Choose one row for each live session. All channels in that row are monitored together.

| Profile | Channels (MHz) |
| --- | --- |
| [SFO and Oakland towers](../profiles/sfo-oak-towers.json) | **120.500** SFO Tower, **118.300** Oakland North Tower, **118.200** SFO clearance delivery |
| [SFO and Oakland ground](../profiles/sfo-oak-ground.json) | **121.800** SFO Ground, **121.750** Oakland South Ground, **121.900** Oakland North Ground, **121.100** Oakland clearance delivery, **120.500** SFO Tower |
| [Oakland tower and approach](../profiles/oak-airband.json) | **127.200** Oakland South Tower (runway 12/30), **124.900** additional Oakland Tower frequency, **125.350** NorCal Approach East, **127.000** NorCal Approach North |

The presets cover controller and pilot communications. The FAA airport diagrams list tower, ground and clearance assignments. The Oakland Chart Supplement also lists 124.900 MHz without a runway assignment. The terminal area chart identifies the Oakland approach sectors. [FAA SFO airport diagram](https://aeronav.faa.gov/d-tpp/2611/00375AD.PDF) · [FAA Oakland airport diagram](https://aeronav.faa.gov/d-tpp/2611/00294AD.PDF) · [FAA Oakland Chart Supplement, p. 224](https://aeronav.faa.gov/Upload_313-d/supplements/CS_SW_20261029.pdf#page=226) · [FAA San Francisco terminal area chart](https://aeronav.faa.gov/visual/10-29-2026/PDFs/San_Francisco_TAC.pdf#page=1)

```sh
cargo run --release --locked -- --mode live --profile profiles/sfo-oak-towers.json --python python3
```

## Hardware and receive checks

The live adapter uses GNU Radio 3.10 with its Python modules, gr-soapy, SoapySDR, the RTL-SDR device module, and an RTL-SDR Blog V3 with an antenna. Run these with the same Python that will start the receiver.

```sh
python3 -c 'from gnuradio import analog, blocks, filter, gr, soapy; import numpy; print(gr.version())'
SoapySDRUtil --find="driver=rtlsdr"
```

Only one program can open the dongle at once. The receiver configures manual gain, profile tuning, and bias tee off. To check reception in the Bay Area, select the [weather profile](../profiles/noaa-weather.json) and listen for intelligible speech on KHB49. A handheld tuned to the same frequency gives a second reception check. For marine activity, compare the handheld and A16T during an existing on-air call.

The [National Weather Service](https://www.weather.gov/mtr/nwr) lists Bay Area stations, and the [FCC](https://docs.fcc.gov/public/attachments/DA-17-886A1.pdf) explains the conditions for shore use of portable marine radios.

The Bay Area weather profile starts at 43.9 dB tuner gain. This setting produced recognizable tide information at 162.400 MHz during the initial field check. Adjust gain for your antenna and local signal strength.

The adapter accepts `--gain-db` and `--squelch-db`. Squelch defaults to −52 dBFS using the channel-filtered complex signal. When a channel is quiet, it emits zeros at the normal rate. Lowering the threshold, for example to −65 dBFS, can reveal weak signals and background noise. The squelch threshold is separate from the Rust detector's audio threshold. A continuous weather broadcast can produce back-to-back bounded clips.

## Synthetic audio

Audio replay works with the Python standard library and completes in 6.5 seconds. On the first configured channel, a 640 Hz tone follows 2.5 seconds of silence. A single isolated click follows the burst. Other channels stay quiet. Replay runs at real-time speed unless `--fast` is set. Use the application replay mode for browser playback.

## Raw receiver input

The IQ adapter accepts unsigned interleaved 8-bit I/Q byte pairs from `rtl_sdr` and uses the profile's center frequency and capture sample rate. At 2.4 million pairs per second, capture consumes 4.8 MB per second. Keep raw captures in the ignored `captures/` directory and record which profile was used. IQ mode processes the file through the same channel filters, squelch, and demodulators as live capture. Sample indexes retain the input timing even when the file processes faster than real time.

Generate a six-second NFM test capture using synthetic signals. The generator requires NumPy and creates a new file.

```sh
mkdir -p captures
python3 receiver/generate_iq.py --profile profiles/eastbay-marine.json captures/generated-marine.cu8
```

Use `profiles/oak-airband.json` and a separate output filename for AM. To capture two seconds of radio input for the East Bay marine profile on a connected receiver, stop any other receiver process and run:

```sh
rtl_sdr -f 156875000 -s 2400000 -g 28 -n 4800000 captures/eastbay-example.cu8
```

Select a fresh filename for each radio capture because `rtl_sdr` may replace an existing file. These developer commands exercise the adapter directly and save its binary output to ignored storage:

```sh
python3 receiver/receiver.py --mode iq --profile profiles/eastbay-marine.json --iq-file captures/generated-marine.cu8 > captures/generated.frames
python3 receiver/receiver.py --mode live --profile profiles/noaa-weather.json --duration 10 > captures/weather.frames
```

## Adapter protocol

One adapter process uses standard output for binary channel frames and standard error for diagnostics. Each frame starts with 18 bytes encoded as little-endian `<4sHIQ`.

| Field | Meaning |
| --- | --- |
| 4 bytes | ASCII magic `A16F` |
| Unsigned 16-bit | Zero-based index into the profile's channel list |
| Unsigned 32-bit | Count of mono samples following this header, 1–2048 |
| Unsigned 64-bit | Index of the first sample since this channel's session began |

The payload contains signed little-endian 16-bit PCM. Each channel starts at sample zero and advances independently. Frames from different channels can interleave. Per-channel indexes identify missing adapter output. USB overruns that a device driver does not expose in its samples can still leave gaps in real reception.

## Verification

```sh
python3 -m unittest discover -s receiver/tests -v
A16T_TEST_GNURADIO=1 python3 -m unittest discover -s receiver/tests -v
```

The opt-in test generates RF input, runs the full GNU Radio receive path for AM and NFM, checks the recovered tone frequency and quiet intervals, and checks adjacent channels. It requires GNU Radio and NumPy and can run without attached hardware.
