# Field verification

First run the replay in the README. Confirm one playable clip and a `replay` source label. For an RF-path check, use the generated aviation or marine IQ input described in [Receiver and replay](receiver.md). These runs exercise decoding and detection in a repeatable way.

For a live check, connect a receiver and antenna, check USB detection, and choose a local broadcast known to be on air. In the San Francisco Bay Area, the KHB49 weather broadcast is on 162.400 MHz. It needs the separate weather profile because it is outside the East Bay marine window. Compare the handheld and A16T on the same frequency. A current sample indicator establishes data flow. Verify actual intelligible words in a clip before reporting a successful voice capture. [National Weather Service Bay Area station list](https://www.weather.gov/mtr/nwr)

```sh
cargo run --release --locked -- --mode live --profile profiles/noaa-weather.json --duration 20 --keep-wav --once
cargo run --release --locked -- --mode live --profile profiles/eastbay-marine.json
```

A quiet marine window may contain no traffic. Compare a call audible on a second receiver to the clip timing and first and last words. Record duration, channel, frequency, gain, RF squelch, and whether audio was intelligible. Keep operator-specific locations and raw radio captures local. Public samples should contain only material suitable for redistribution with the sender or broadcast source identified and its provenance reviewed. Generating RF is unnecessary for these receive-only checks.

## Public field sample

The [KHB49 recording](../examples/weather-broadcast.opus) contains 15 seconds of an over-the-air tide forecast. The tuner used 43.9 dB gain, and the GNU Radio file receiver demodulated the captured RF using −52 dBFS squelch. The exported sample uses 64 kbit/s Opus to preserve speech mixed with static. Two local recognizers recovered the same tide height and time from a decode of those exact bytes. Ordinary application clips use the 20 kbit/s setting documented in the archive guide. [Capture metadata](../examples/weather-broadcast.json)
