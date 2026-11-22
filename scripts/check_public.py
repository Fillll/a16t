#!/usr/bin/env python3
"""Review staged public artifacts without printing secret values or reading local data."""
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
SIGNATURE = re.compile(
    rb"(?:sk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{22,}|hf_[A-Za-z0-9]{20,}|"
    rb"gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{30,}|"
    rb"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|"
    rb"\$ANSIBLE_VAULT;[0-9]|\$6\$[A-Za-z./0-9]{4,}\$[A-Za-z./0-9]{50,})"
)
PRIVATE_PARTS = {"runtime_data", "captures", "pipeline", ".vault-password", ".DS_Store"}
PRIVATE_SUFFIXES = {".token", ".sqlite", ".sqlite3", ".db", ".zip", ".cu8", ".c64",
                   ".rttm", ".wav", ".opus", ".ogg", ".frames", ".mp3", ".pem", ".key"}
PUBLIC_AUDIO = "examples/weather-broadcast.opus"
PUBLIC_METADATA = "examples/weather-broadcast.json"


def git(*args):
    return subprocess.check_output(["git", *args], cwd=ROOT)


def main():
    issues = []
    entries = git("ls-files", "--stage", "-z").split(b"\0")
    files = {}
    for record in filter(None, entries):
        metadata, path = record.split(b"\t", 1)
        mode, oid, stage = metadata.split()
        name = path.decode()
        if mode not in {b"100644", b"100755"} or stage != b"0":
            issues.append(f"{name}: unexpected Git entry")
            continue
        files[name] = oid.decode()
    for name, oid in files.items():
        path = Path(name)
        if (set(path.parts) & PRIVATE_PARTS or path.name == ".env" or path.name.startswith(".env.")
                or (path.suffix.lower() in PRIVATE_SUFFIXES and name != PUBLIC_AUDIO)):
            issues.append(f"{name}: private file type or directory")
            continue
        data = git("cat-file", "blob", oid)
        if name == PUBLIC_AUDIO:
            try:
                info = json.loads(git("cat-file", "blob", files[PUBLIC_METADATA]))
                valid = (
                    info["sha256"] == hashlib.sha256(data).hexdigest()
                    and info["source"] == "live" and info["frequency_hz"] > 0
                    and data.startswith(b"OggS") and b"OpusHead" in data[:256]
                )
                if not valid:
                    raise ValueError("mismatched provenance")
            except (ValueError, KeyError, TypeError):
                issues.append(f"{name}: missing or mismatched field recording provenance")
        elif b"\0" in data or SIGNATURE.search(data) or re.search(rb"/Users/[a-zA-Z0-9_-]+/", data):
            issues.append(f"{name}: binary content, credential-shaped text, or personal path")
    for msg in issues:
        print(msg, file=sys.stderr)
    if not issues:
        print(f"Checked {len(files)} indexed files for public distribution")
    return bool(issues)


if __name__ == "__main__":
    sys.exit(main())
