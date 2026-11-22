# Demo Mode

> **Prototype archive.** This page describes the earlier Python prototype. Its commands, paths, release numbers, and plans apply to that implementation. For the Rust application, see the [current documentation](../README.md).

A16T demo mode seeds synthetic transmission history into a separate local SQLite database so the web UI can be reviewed without radio hardware, recorded fixtures, or paid transcription.

The first scenario is `treasure-island-sf-bay`: a rolling 24-hour maritime log from the perspective of a receive point on Treasure Island in San Francisco Bay. It is not real recorded traffic. It combines hand-shaped anchor calls with deterministic generated traffic so the Watchboard, review filters, transcript detail, participant labels, and message priority states look like a plausible busy local operating day.

## Run It

```sh
python3 scripts/dev.py run-no-radio --demo-scenario treasure-island-sf-bay
```

Then open:

```text
http://127.0.0.1:8787
```

The browser defaults to the 24-hour window when this demo scenario is active. The app still runs on the `marine-vhf` profile, uses the `no-radio` backend, and stores demo records in `runtime_data/demo_treasure_island_sf_bay.sqlite3`.

## Scenario Shape

The scenario is busy but not flat. It targets roughly 1,400-1,900 push-to-talk transmissions per rolling day, with overnight lows, ferry/commercial commute peaks, afternoon recreational traffic, and peak hours above 100 transmissions per hour. Traffic clusters on the channels that would make the most sense for this receive point:

- Channel 14: San Francisco Traffic / VTS-style central bay traffic, ferries, tugs, tankers, pilots, and deep-draft movement reports.
- Channel 13: bridge-to-bridge navigation safety, meeting arrangements, ferry and tug passing calls.
- Channel 16: distress, safety, calling, Coast Guard hails, and safety broadcast announcements.
- Channel 22A: Coast Guard safety broadcasts and follow-up coordination.
- Channels 9, 68, 69, 71, and 72: marina, recreational, race committee, and working-channel chatter.
- Channels 10, 11, and 12: lighter commercial, port operations, and offshore/VTS-adjacent traffic.
- Channel 70 is deliberately unused for decoded voice because it is Digital Selective Calling rather than a normal voice channel.

The seeded records are completed transmissions with:

- synthetic transcripts,
- `demo` transcription provider metadata,
- high-density generated traffic plus hand-shaped anchor calls,
- participant labels such as `San Francisco Traffic`, `Coast Guard San Francisco`, ferries, tugs, pilot boats, marinas, and sailing vessels,
- message classifications such as `routine`, `safety`, `weather`, `urgency`, `clearance/instruction`, and `acknowledgement/readback`,
- a small urgent `Pan-pan` sequence near Treasure Island so alert styling can be tested without making emergencies the dominant visual state,
- a few rolling recent transmissions so the 15-minute and 1-hour views still have visible activity.

## Source Assumptions

The channel choices are grounded in public U.S. maritime guidance, then adapted into synthetic local traffic:

- [USCG NAVCEN U.S. VHF channel information](https://www.navcen.uscg.gov/us-vhf-channel-information) for common U.S. marine VHF channel purposes, including Channel 16, Channel 13, Channel 22A, recreational/non-commercial working channels, and Channel 70 voice restrictions.
- [33 CFR 161.12 via eCFR](https://www.ecfr.gov/current/title-33/chapter-I/subchapter-P/part-161/subpart-B/section-161.12) for Vessel Traffic Service radio listening/reporting requirements, including San Francisco VTS channel assignments.

The transcripts, vessel names, timing, and event sequence are fabricated. They should be realistic enough for UI review, but they should never be used as evidence of actual radio traffic.

Public sources do not publish a simple "VHF push-to-talk transmissions per hour" count for the Treasure Island receive point. The demo density is therefore an estimate: low overnight, 40-80 transmissions per ordinary daytime hour, and 100+ during busy commute or afternoon/evening periods.

## Boundary

Demo mode belongs under `src/a16t/demo/`. It may create normal storage records and local placeholder clip files, but it must not import web UI internals, radio backends, transcription providers, or GNU Radio code. The web startup may seed a demo before creating `MonitorService`; after that, the API should treat demo records like ordinary stored transmissions.
