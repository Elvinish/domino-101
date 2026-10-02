# Phase 0 + Phase 1 — rebuild foundation

## Phase 0 inspection

The supplied workspace contained only `MASTER_PROMPT.md`, `docs/PRODUCT_SPEC.md`,
`docs/GAME_RULES.md`, `docs/ARCHITECTURE.md`, and a macOS `.DS_Store` file. There was
no Git metadata, package manifest, application source, dependency lockfile, or test
configuration. No deleted repository was sought or used for this rebuild.

## Phase 1 implementation

Created pnpm workspaces for web, server, game-engine, protocol, and bot-player;
strict shared TypeScript; ESLint; Prettier; Vitest; React Testing Library; a React
19/Vite/Tailwind/React Router boot screen; a Fastify health endpoint; separate app
factory and process lifecycle; validated server and public web environments;
compiled ESM package exports; and root development/build/check commands.

Updated the authoritative rules with the requested post-first-round double opening
and SEKA starter preservation, including first-round SEKA. No game logic was added.
Original design documents remain reference material. Engine/bot packages are empty
boundaries, not claimed implementations.

## Verification

Verified on macOS with Node **24.21.0** and pnpm **10.34.5**. The system default
Node 23 was not used for these checks; a temporary Node 24 toolchain was used.
Direct dependency versions and pnpm are pinned; `pnpm-lock.yaml` is included in the project files (no Git commit was created).

| Check                                | Result                                                         |
| ------------------------------------ | -------------------------------------------------------------- |
| Dependency installation              | PASS — all 6 workspace projects                                |
| Frozen lockfile offline installation | PASS — lockfile current; dependencies up to date               |
| `pnpm format:check`                  | PASS — all matched files                                       |
| `pnpm lint`                          | PASS — zero errors/warnings                                    |
| `pnpm typecheck`                     | PASS — all 5 packages/apps plus root test configuration        |
| `pnpm test`                          | PASS — 5 files, 30 tests, zero failures/skips                  |
| `pnpm build`                         | PASS — 3 shared packages, server, web                          |
| Compiled server process smoke        | PASS — real HTTP `/health` 200, exact response, SIGTERM exit 0 |
| Web production preview smoke         | PASS — HTML and bundled JavaScript served with HTTP 200        |

Tests cover server defaults/overrides/invalid settings and sanitized errors (12),
Fastify HTTP integration (3), health DTO validation (5), public web environment
validation (8), and boot/not-found routing with React Testing Library (2).
There are no placeholder passing tests for the empty engine/bot packages.

An initial run found malformed URL validation escaping the intended sanitized
error; this was fixed and all tests rerun. Deprecated configuration options and a
Vite extension warning were also corrected. The final build is warning-free.

Package download/store access and real local port checks required sandbox
permissions. No application changes were made to work around those restrictions.

## Unverified and deferred

No real-browser desktop/phone rendering or Playwright E2E was run. React tests use
jsdom; the production preview smoke checks HTTP serving, not browser execution.
No PostgreSQL, migrations, Socket.IO, game simulations, production deployment, or
WebRTC checks apply at this phase. No remote CI run was performed. The repository
is ready for Phase 2 implementation, not ready for deployment as a playable game.

## Scope boundary

Stop after Phase 1. Game engine, deterministic bots, room protocol, sockets,
private projections, reconnect, chat, persistence, WebRTC, and deployment are not
implemented. PostgreSQL, Socket.IO, and multiplayer browser tests cannot validate
features that do not exist yet. No domain, hosting, or TURN was provisioned.
