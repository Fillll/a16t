# Live Hardware Verification

> **Prototype archive.** This page describes the earlier Python prototype. Its commands, paths, release numbers, and plans apply to that implementation. For the Rust application, see the [current documentation](../README.md).

Live verification is the manual checklist for an RTL-SDR Blog V3 session. It complements automated tests and fixture validation; it should remain opt-in because normal development and CI must run without radio hardware.

## Before Running A16T

1. Attach the RTL-SDR Blog V3 directly or through a known-good USB cable.
2. Keep bias tee off unless a compatible powered device needs it.
3. Close other SDR applications that may already have the dongle open.
4. Confirm the OS can see the USB device.
5. Confirm RTL-SDR tools can open it:

```sh
rtl_test -t
```

6. Run A16T preflight:

```sh
python3 scripts/dev.py preflight --profile iad-airband --radio-backend gnuradio --hardware
python3 scripts/dev.py preflight --profile marine-vhf --radio-backend gnuradio --hardware
```

## Troubleshooting USB Detection

If `rtl_test` reports `No supported devices found`, check USB enumeration first. Reseat the dongle and try a known-good cable or a direct port. If the OS lists the device, check RTL-SDR driver support and USB permissions. If opening the device fails because it is busy, stop other SDR processes. Run hardware probes and GNU Radio captures one at a time because only one process can claim the dongle.

## Useful Commands

Check whether the OS sees USB devices:

```sh
system_profiler SPUSBDataType
```

Check RTL-SDR tooling:

```sh
which rtl_test
rtl_test -t
```

Check SoapySDR visibility:

```sh
which SoapySDRUtil
SoapySDRUtil --find
```

Run A16T without the hardware probe when you only need runtime/profile validation:

```sh
python3 scripts/dev.py preflight --profile marine-vhf --radio-backend gnuradio
```

## East Bay Radio

The [East Bay marine profile](../../profiles/eastbay-marine.json) receives San Francisco Traffic, the inshore Vessel Traffic Service, on Channel 14 (156.700 MHz) alongside Channels 13, 16, and 22A in one tuning window. The [Coast Guard VTS guide](https://www.navcen.uscg.gov/sites/default/files/pdf/VTS%20User%20Guides/VTS_SF_UserManual_APR2025.pdf) and [U.S. marine channel list](https://www.navcen.uscg.gov/us-vhf-channel-information) describe their use.

```sh
python3 scripts/dev.py preflight --profile eastbay-marine --radio-backend gnuradio --hardware --transcription-provider local
python3 scripts/dev.py run --profile eastbay-marine --radio-backend gnuradio --transcription-provider local
```

Use `--profile oak-airband` in both commands for [Oakland Tower South (127.200 MHz) and NorCal Approach (125.350 and 127.000 MHz)](../../profiles/oak-airband.json). Oakland Tower North (118.300 MHz) and D-ATIS (133.775 MHz) each require a separate tuning window. See the [FAA Oakland airport diagram](https://aeronav.faa.gov/d-tpp/2611/00294AD.PDF) and [Bay Area terminal chart](https://aeronav.faa.gov/visual/10-29-2026/PDFs/San_Francisco_TAC.pdf).

For a reception check, stop A16T to free the dongle. Use a standalone receiver to listen to [NOAA Weather Radio KHB49](https://www.weather.gov/mtr/nwr) at 162.400 MHz in narrow FM or Oakland D-ATIS at 133.775 MHz in AM. Verify intelligible audio before returning to intermittent marine or tower traffic. Reception at one frequency only verifies the receiver path for that signal.

## Capture Notes

When hardware is visible and there is useful signal, capture short receive-only IQ/radio-stream fixtures for later validation. Keep them small, store them outside normal CI paths, and validate their manifests with:

```sh
python3 scripts/dev.py capture-radio-fixture --profile iad-airband --duration-sec 0.25 --name iad-smoke
python3 scripts/dev.py validate-radio-fixture runtime_data/fixtures/iad-smoke.radio-stream.json
```
