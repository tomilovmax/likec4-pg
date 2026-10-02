# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Current repository scope

The repository currently contains a LikeC4 requirements graph, not an implemented Web IDE. `requirements.likec4` is the source of truth for the implementation backlog of a self-hosted LikeC4 Web IDE. There are currently no application packages, Docker files, test suites, or project-local build/lint scripts.

The planned MVP is a browser IDE for a single server-configured filesystem workspace. Its global boundaries are stated at the top of `requirements.likec4`: no Git integration, authentication, database, collaboration, history, AI, Kubernetes, or CI/CD deployment. Preserve these constraints unless the requirements graph is intentionally changed.

## Working with the requirements graph

- `specification` defines status element types: `requirement_open`, `requirement_partial`, and `requirement_met`.
- `model` contains the backlog. Each `req_*` node must be independently deliverable as a functional result in one MR, with observable acceptance criteria. Do not add nodes that only express research, intention, or a general preference.
- An arrow points from a prerequisite to the requirement it unblocks.
- `views.delivery_path` is deliberately the only view. It includes the entire graph and is the canonical implementation order; do not add thematic duplicate views.
- LikeC4 source DSL files remain the source of truth. In particular, no future Web IDE feature may serialize a parsed LikeC4 model back into a user’s `.c4` or `.likec4` file.

## Commands

The LikeC4 CLI discovers `.c4` sources, while the graph is stored with the `.likec4` extension. Validate it by copying it into a temporary workspace with a `.c4` extension:

```bash
tmpdir=$(mktemp -d) && trap 'rm -rf "$tmpdir"' EXIT && cp requirements.likec4 "$tmpdir/requirements.c4" && npx --yes likec4 validate "$tmpdir"
```

No build, lint, unit-test, or single-test command exists until the planned application is added. When implementation introduces tooling, update this section with the exact repository commands and the command for an individual test.
