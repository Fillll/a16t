# ADR 0001: Use Docs As The Product Boundary

> **Prototype archive.** This page describes the earlier Python prototype. Its commands, paths, release numbers, and plans apply to that implementation. For the Rust application, see the [current documentation](../../README.md).

## Status

Accepted

Superseded in part by [ADR 0005](0005-use-documentation-folder.md), which keeps the source-of-truth documentation boundary but renames the folder from `docs/` to `documentation/`.

## Context

The repository began as a proof of concept for monitoring a small set of Washington Dulles airband frequencies. The desired product is broader: a small local app for monitoring multiple radio frequencies, starting with aviation or marine use cases.

The current code works as a prototype, but the product direction needs to be explicit before more implementation accumulates.

## Decision

Create a documentation folder and use it as the source of truth for product scope, architecture, UI concepts, and architecture decisions. The original folder was `docs/`; ADR 0005 renames it to `documentation/`.

## Consequences

- Future code should be evaluated against the docs.
- Big changes should add or update Architecture Decision Records.
- The current IAD monitor becomes an example profile, not the whole product.
