# Working on A16T

Read this file, the [knowledge index](documentation/README.md), and the owning implementation and tests before changing behavior. Current code and configuration describe the public application. The prototype documentation is a historical reference.

## Ownership

- Keep the product local and receive-only. Rust owns detection, recording, durable jobs, storage and the application API. Python owns GNU Radio capture and demodulation. The Watchboard uses the API as a client. Keep the core usable by a future native UI.
- Keep live radio optional. Replay and tests work without a dongle. New live behavior should also be exercisable from generated RF inputs whenever practical. A real field recording needs separate provenance and reception verification.
- Keep the dongle bias tee off by default. Compare audio from a reference receiver when diagnosing reception. Paid providers require explicit opt-in and only receive bounded, finished clips.
- Keep the Watchboard usable on a small laptop or phone. Show activity, disconnects and errors in words as well as color.

## Knowledge and workflow

Keep durable knowledge in `documentation/`, index every current page, and update the owning page when changing architecture, APIs, schemas, operator procedures or important defaults. Record substantial design choices in `documentation/adr/`. Keep release notes in `VERSION.md`. Update agent instructions when future contributors must change how they work.

For routine solo work use the current branch and its configured upstream. Use a separate branch and PR when asked for review or when collaborating. Preserve unrelated changes and run the relevant validation before committing and pushing. Never force-push.

## Public files

Use synthetic, reproducible fixtures in normal tests. Keep credentials, local runtime databases, operator-specific paths, raw RF captures, privately received conversations and provider output outside Git. Public field samples require review of the actual audio and identifying details plus source, capture settings, and checksum metadata. Stage named source paths and run `python3 scripts/check_public.py` on the index. Never mirror refs from another repository.

## Validation

```sh
cargo fmt --all --check
cargo clippy --locked --all-targets -- -D warnings
cargo test --locked
cargo build --locked
python3 -m unittest discover -s receiver/tests -v
python3 -m unittest discover -s tests -v
python3 scripts/check_public.py
git diff --check
```

Run `A16T_TEST_GNURADIO=1 python3 -m unittest discover -s receiver/tests -v` with the GNU Radio interpreter after changing the real DSP chain. This uses synthetic IQ and does not claim the USB device.
