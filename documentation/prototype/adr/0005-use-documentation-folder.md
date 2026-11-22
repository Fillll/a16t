# ADR 0005: Use Documentation Folder

> **Prototype archive.** This page describes the earlier Python prototype. Its commands, paths, release numbers, and plans apply to that implementation. For the Rust application, see the [current documentation](../../README.md).

## Status

Accepted

## Context

ADR 0001 made repository documentation the source of truth for product scope, architecture, UI concepts, and architecture decisions. The folder was originally named `docs/`.

GitHub Pages can use a root-level `/docs` folder as a publishing source. A16T's documentation folder is product and architecture source material, not a website publishing root. Keeping the name `docs/` can make repository intent ambiguous.

## Decision

Rename the documentation source-of-truth folder from `docs/` to `documentation/`.

All contributor guidance, README links, folder-structure documentation, implementation-plan references, and future ADRs should point to `documentation/`.

## Consequences

- `documentation/` is the canonical source of truth for product, architecture, UI, technology, and ADR direction.
- `docs/` should not be recreated unless the project intentionally adds a GitHub Pages publishing source later.
- Code and README links should use `documentation/...` paths.
- ADR 0001 remains historically accurate about the original decision, but ADR 0005 supersedes the folder name.
