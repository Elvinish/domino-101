# Domino 101

Azerbaijani-style Domino “101”: four guests, two opposing teams, private rooms.
**Rebuild status: Phases 0–9 implemented.** The pure engine, deterministic QA bots, authoritative Socket.IO room server, responsive React multiplayer UI, secure reconnect, room chat/reactions and PostgreSQL persistence are implemented. Four friends can create a private room, play a complete match, and restore their seats after refresh, a temporary disconnect or a server restart in PostgreSQL mode. English, Russian and Azerbaijani UI, accessible state feedback and optional quiet sound cues are included. Optional audio-only room voice chat uses a four-player WebRTC mesh, with microphones off until explicitly enabled.

## Requirements and quick start

- Node.js 24 LTS (see `.node-version` / `.nvmrc`).
- pnpm 10.34.5, pinned in `package.json`. Install with `npm install -g pnpm@10.34.5`, or use your package-manager version manager.

```sh
pnpm install --frozen-lockfile
cp .env.example .env
pnpm dev
```

Web: <http://localhost:5173>. Server health: <http://localhost:3001/health>.
The environment file is optional for the default local setup. Shell variables take
precedence. The server loads the root `.env`; Vite reads root `.env` and its standard
mode-specific variants. Restart development processes after changing configuration.
The server defaults to loopback; set `HOST=0.0.0.0` explicitly for a container.

## Structure

```text
apps/
  web/             React 19, React Router, Vite 8, responsive multiplayer table
  server/          Fastify + Socket.IO, authoritative rooms, Drizzle/PostgreSQL and private projections
packages/
  game-engine/     Pure deterministic game engine, scoring and match state machine
  protocol/        Shared strict Zod health, room, command, chat, voice signaling and snapshot contracts
  bot-player/      Deterministic strategies, seeded full-match simulation and invariant checks
docs/              Authoritative rules, product/architecture design, phase reports
```

Shared strict compiler settings live in `tsconfig.base.json`. Node packages use
ES modules with NodeNext resolution and real compiled exports. Browser code uses
Vite bundler resolution. No cross-workspace source aliases bypass package boundaries.
Root build/test/typecheck commands build shared packages first in dependency order.
If shared package code changes during `pnpm dev`, run `pnpm build:packages` to refresh
compiled exports (or restart `pnpm dev`). Shared-package watch orchestration is not
introduced at this stage.

## Commands

| Command                             | Purpose                                                                     |
| ----------------------------------- | --------------------------------------------------------------------------- |
| `pnpm dev`                          | Build shared packages, then start web and server watchers                   |
| `pnpm build:packages`               | Compile shared package JS and declarations                                  |
| `pnpm build`                        | Build all packages and both production apps                                 |
| `pnpm typecheck`                    | Check all workspace source, tests, and TypeScript configuration files       |
| `pnpm lint`                         | ESLint, with zero warnings allowed                                          |
| `pnpm format`                       | Apply Prettier                                                              |
| `pnpm format:check`                 | Check formatting                                                            |
| `pnpm test`                         | Run all Vitest projects once, including Fastify integration and React tests |
| `pnpm test:watch`                   | Watch the test suite                                                        |
| `pnpm test:postgres`                | Run required real PostgreSQL integration tests using `TEST_DATABASE_URL`    |
| `pnpm test:voice`                   | Run voice protocol, signaling, lifecycle, UI and ICE configuration tests    |
| `pnpm test:socket`                  | Run the existing real Socket.IO integration tests                           |
| `pnpm db:generate`                  | Generate Drizzle migration SQL and metadata after schema changes            |
| `pnpm db:migrate`                   | Apply checked-in migrations using `DATABASE_URL`                            |
| `pnpm verify`                       | Formatting, lint, typecheck, tests, production build                        |
| `pnpm start`                        | Run the compiled server after a build                                       |
| `pnpm --filter @domino/web preview` | Preview the web production build locally                                    |

`GET /health` returns exactly `{"status":"ok"}`. It is a process liveness check;
no database or gameplay readiness is implied. App construction is separate from
listening, allowing Fastify injection tests without opening ports. SIGINT/SIGTERM
close the server with a bounded shutdown timeout. Startup errors do not print raw
environment values, and automatic request logging is disabled.

Environment values are validated with Zod before startup/build. `VITE_` variables
are public browser configuration: never store secrets there. `VITE_API_BASE_URL`
is validated and used by the multiplayer client to connect to Socket.IO.

## Architectural boundaries

- `game-engine` has no runtime dependencies, Node typings, DOM libraries, framework,
  transport, or database code. Lint prevents non-relative production imports.
- `protocol` owns shared typed DTOs and strict runtime schemas for health and multiplayer events, including Phase 9 voice signaling.
- `bot-player` strategies see only their own hand and public information. The QA runner submits normal engine commands and checks invariants; bots never score or mutate game state.
- The server owns guest identity, seat assignment, per-room command serialization,
  revisions, bounded command idempotency, private projections and hashed reconnect
  credentials. Socket IDs are transport bindings, not player identities.
- React renders server-provided public state and its own private hand; legal actions
  come from the server. It never imports the game engine or calculates official scores.
- PostgreSQL/Drizzle persists versioned authoritative state behind a repository
  boundary. Room writes commit before in-memory publication, broadcast or success
  acknowledgement. Voice uses browser WebRTC connections; Socket.IO carries only
  validated signaling. Audio never passes through the game server or PostgreSQL.

## Rules and scope

[Game rules](docs/GAME_RULES.md) are the single authoritative source. The root
[GAME_RULES.md](GAME_RULES.md) directs readers there without duplicating the rules.
The older [master prompt](MASTER_PROMPT.md), [product spec](docs/PRODUCT_SPEC.md),
and [architecture](docs/ARCHITECTURE.md) describe the intended full product, not
completed features. The latest rebuild request controls phase scope.

[Phase 0/1 report](docs/PHASE_1.md) records the foundation.
[Phase 2 report](docs/PHASE_2.md) describes the engine API, rules, and verification.
[Phase 2A report](docs/PHASE_2A.md) documents strategies, seed coverage and replay diagnostics.
[Phase 3 report](docs/PHASE_3.md) documents the Socket.IO protocol, authorization,
privacy and disconnect limitations.
[Phase 4 report](docs/PHASE_4.md) documents the playable UI, client state and browser
privacy checks.
[Phase 5 report](docs/PHASE_5.md) documents secure reconnect, local sessions and stale
socket replacement. [Phase 6 report](docs/PHASE_6.md) documents room chat, reactions,
limits, isolation and browser behavior. [Phase 7 report](docs/PHASE_7.md) covers localization, sound, accessibility and responsive polish. [Phase 8 report](docs/PHASE_8.md) documents PostgreSQL transactions, restart recovery, privacy, exact verification results and production limitations. [Phase 9 report](docs/PHASE_9.md) covers room voice, its security and lifecycle, and final project verification.

## Playing with server bots

In a room lobby, the host can **Add bot** to an empty seat, **Remove bot**, or
**Fill empty seats with bots**. One human plus three bots can start and play a normal
match. Bots use the existing deterministic strategy, act after 650 ms and persist
with PostgreSQL rooms. The human host still advances rounds. Controls and bot labels
are available in English, Russian and Azerbaijani.

The additive `0001_dev_bots` migration stores membership kind; deploy the matching
web/server builds together. See [Host-managed bots](docs/DEV_BOTS.md) for scheduling,
privacy, persistence, limitations and final verification. Run the real browser bot
scenario with `pnpm test:e2e e2e/bots.spec.ts`.

Bot-feature verification passed: **532 Vitest tests / 44 files**, including **17
PostgreSQL tests**, **55 Socket.IO tests**, production build, clean/upgrade/repeated
migrations, and **15 Playwright scenarios** across desktop, tablet and phone. Each
bot browser scenario completed a real round. Formatting, lint and full typecheck
also passed. The Phase 9 results below are the historical phase checkpoint.

## QA simulations

```sh
pnpm simulate --seed 0 --count 1000 --strategy seeded-random
pnpm simulate --seed 386 --count 1 --strategy seeded-random
pnpm simulate --seed 0 --count 32 --strategy deterministic-first
```

The command builds shared packages first. Each seed drives all four seats through
normal engine commands to match completion. Failures report seed, configuration,
attempted command, phase and bounded recent public summaries. The default full test
suite includes 1,000 seeded-random matches and 64 first/mixed-strategy matches; allow
roughly a minute for these checks on a typical development machine. The seeded RNG
is for reproducible QA only, not production shuffling. See the Phase 2A report for
the library API, mixed strategies, custom initial snapshots and safety limits.

## Multiplayer backend

Socket.IO shares the Fastify address at `http://localhost:3001`, using its default
`/socket.io` path. Set `WEB_ORIGIN` to the browser's exact origin (default
`http://localhost:5173`). Import event constants, DTOs and schemas from
`@domino/protocol`. Create/join rooms with display names; the server assigns IDs and
seats. Four connected seats and the host's `room:start` request are required.

Game commands carry `roomId`, UUID `commandId`, `expectedRevision` and a typed intent.
Each socket receives only its own hand plus safe public state. The host advances
finished rounds using `next-round`. Full event/payload and idempotency semantics are
in the Phase 3 report. Open `/` to create/join or `/room/:roomId` for an invitation.
The host starts when all four friends are seated. Highlighted tiles are playable;
choose left/right when offered. Refreshing the matching room automatically restores
your saved seat and private hand. Keep the invitation URL; it contains no credentials.

```sh
pnpm test:socket
```

This runs real localhost WebSocket/polling integration tests, including a complete
four-client bot-assisted match and privacy audits. It is also included in `pnpm test`.
The environment must permit localhost listening; no test silently skips a listen
failure. Disconnects reserve seats in lobby and game; active games pause until the
player returns. All-offline rooms are retained for 30 minutes. PostgreSQL mode
preserves state and hashed credentials across restart until expiry. The default
development memory mode loses them on process exit.

## Browser verification

```sh
pnpm exec playwright install chromium
pnpm test:e2e
```

Runs four real browser clients against production-built web and server apps on
isolated ports 4173 and 3101. Desktop completes a match; tablet and phone exercise
real gameplay and disconnect handling. Voice scenarios verify actual local audio
transport with fake capture devices on all three layouts. The tests audit received private projections,
rendered hands and horizontal page overflow. Local screenshots go to ignored
`test-results/`. Run `pnpm build` afterward to restore the normal web environment
configuration. Browser tests are separate from `pnpm verify`.

## Saved seats and reconnect

The browser stores a private per-room reconnect credential in localStorage. It is
never shown in the UI or invite URL. Reloading `/room/:roomId` restores the same
player, seat, hand and match when the session is valid. Temporary transport loss
attempts recovery automatically; Retry connection is available if needed. Opening
the same room in another tab transfers ownership to the newest authenticated tab.

Leave table intentionally clears the saved session and revokes it on the server
when connected. It releases a lobby seat; leaving an active match reserves that
seat permanently until room expiry, so use a new room if someone leaves deliberately.
Ordinary refresh does not revoke a session. Browser storage denial is explained in
the UI; invalid/expired sessions return safely to entry. See Phase 5 for the
security model and Phase 8 for persistence. Production requires HTTPS/WSS and
origin security. Guest reconnect credentials are not account authentication.

## Room chat

The lobby and match views include an optional room chat panel. Messages are plain
text, trimmed, limited to 500 characters, retained only as the latest 50 messages
per room (including in PostgreSQL), and rate-limited to five messages per player per ten seconds. Reactions
are predefined and ephemeral. The server derives sender identity from the current
socket membership and sends history only to the requesting room member; stale
sockets and cross-room attempts are rejected. See [Phase 6](docs/PHASE_6.md) for
the protocol, privacy audit and verification record.

## Room voice

Voice is optional in both lobby and match. Choose **Enable microphone** to join,
then **Mute microphone**, **Unmute microphone** or **Leave voice**. Muting keeps the
existing track but disables outgoing audio; leaving stops it. Reload, disconnect,
replacement by another tab and page teardown stop voice. Reconnecting the table
requires another explicit microphone action. Permission or connection failures
leave game and chat usable. Remote audio that the browser blocks has a **Play voice
audio** button. No speaking indicator, video, recording or media persistence exists.

Up to four players connect in a mesh (at most three peers each). The lower seat
initiates each offer; a new voice session invalidates old offers and ICE. Every
signal is authorized against the current socket and room. Names and sender IDs
come from the server. SDP and ICE are neither logged nor persisted.

`VITE_WEBRTC_ICE_SERVERS` is validated JSON, embedded at web build time. Omit it for
`[{"urls":["stun:stun.l.google.com:19302"]}]`; use `[]` for host-only local tests.
An example configuration is in `.env.example`. TURN URLs need `username` and
`credential`. Browser credentials are public: use scoped, short-lived credentials
in production, never an administrative secret. A dynamic credential issuer is
not implemented. Without TURN, some NAT/firewall combinations cannot connect.
TURN is configurable but has not been provisioned or tested against a live relay.
Production microphone access requires HTTPS (localhost is permitted for development).
P2P connection setup can reveal network addresses to other room participants;
STUN is contacted only after voice is enabled and a peer connection is needed.

`pnpm test:voice` runs focused tests. Playwright checks received audio RTP packets,
playback, a four-participant desktop mesh, mute/unmute, refresh cleanup and touch
controls at phone/tablet sizes. It requests Chromium fake microphone devices by
default. On this macOS environment native fake capture failed with
`NotSupportedError` (other Chromium modes stalled). Final browser verification used
`DOMINO_E2E_SYNTHETIC_AUDIO=1 pnpm test:e2e`: a test-only Web Audio source replaces
capture while peer connections, signaling, RTP and playback remain native. This
fallback is explicit, never automatic, and does not exist in the production app.
Native microphone acquisition, physical audio quality, Safari/iOS and restrictive
network paths remain unverified. See [Phase 9](docs/PHASE_9.md) for exact final results and limitations.

## Language, accessibility and sound

Choose English, Русский or Azərbaycanca in the header; changes take effect without
reloading. English is the default. The selection is kept in localStorage under
`domino101.language`, separate from private room sessions. Player names, tile
values and room codes are never translated.

Sound starts muted. Enable sound to opt into short cues for turns and results and
five recorded domino placements bundled at `apps/web/public/audio/domino/`. The
preference is stored under `domino101.sound`; even with a saved opt-in, each new
page waits for a user gesture before activating audio. Placement audio rotates
across the short recorded clips with subtle level and rate variation. Missing or
blocked files fail quietly and never affect play. Source provenance and the
reproducible extraction recipe are in [audio asset details](docs/AUDIO_ASSETS.md).
Sound is separate from room voice; enabling sound does not enable the microphone.

Keyboard users can skip to the game, reach legal actions, choose an end and use
Escape to cancel that choice. Turn/player/pending states include text and marks,
with localized live announcements. Reduced motion preferences disable tile
movement and transitions. Phone layouts wrap the hand, keep chat below controls
and respect screen safe areas. Chat includes timestamps, unread counts and scroll
position preservation while reading older messages.

`pnpm exec vitest run --project web` runs the frontend subset. `pnpm test:e2e`
runs existing multiplayer/reconnect flows and the Phase 7 language, sound, chat,
keyboard, reduced-motion and privacy scenario at desktop, tablet and phone sizes.
See [Phase 7](docs/PHASE_7.md) for exact results and unverified environments.

## PostgreSQL development and production

The default `PERSISTENCE_MODE=memory` is useful for ephemeral local work.
`NODE_ENV=production` requires `PERSISTENCE_MODE=postgres` and a valid
`DATABASE_URL`. A database failure at startup prevents the server from listening;
failed room writes lock that room until restart/recovery. `/health` remains a
liveness endpoint, not an ongoing database readiness probe.

Optional PostgreSQL-only Docker Compose setup:

```sh
cp .env.example .env
# Edit .env: set POSTGRES_PASSWORD to your own password, PERSISTENCE_MODE=postgres,
# and DATABASE_URL=postgresql://domino:<URL-encoded-password>@127.0.0.1:5432/domino101
docker compose up -d postgres
pnpm db:migrate
pnpm dev
# When finished; the named database volume is retained:
docker compose down
```

Alternatively use an existing PostgreSQL server. Do not put database credentials
in `VITE_` variables, source control or logs. Startup applies the checked-in
Drizzle migrations before restoring validated rooms. Ship `apps/server/drizzle/`
with `apps/server/dist/`; the compiled migration command is
`pnpm --filter @domino/server db:migrate:production` after `pnpm build`.

For integration tests, create a **separate disposable database ending in `_test`**
and export its URL as `TEST_DATABASE_URL` in the test shell (the Vitest runner does
not load `.env`). For Compose, create it with:

```sh
docker compose exec -T postgres createdb -U domino domino101_test
# Export TEST_DATABASE_URL with your local credentials, then:
pnpm test:postgres
pnpm test
```

The suite deletes room data in that test database. `pnpm test:postgres` fails when
the test URL is missing. The ordinary full suite explicitly skips PostgreSQL
tests without that variable; supply it for complete verification. Socket.IO
integration requires localhost networking. Browser tests use a separate ephemeral
server; real PostgreSQL tests cover the server A/server B restart lifecycle.

Production currently supports **exactly one application instance** per database.
Stop it before starting a replacement; there is no distributed locking or rolling
multi-instance deployment. Provide PostgreSQL, persistent storage, backups and
restore procedures, appropriate database access controls/TLS, HTTPS/WSS, the exact
`WEB_ORIGIN`, and monitoring. Database tables and backups contain private hands
and chat; only reconnect-token hashes are stored. No hosting or TURN is provisioned.

## Final Phase 9 verification

All final local checks passed: frozen install, Prettier, lint, full typecheck,
**496 Vitest tests / 40 files**, **15 PostgreSQL integration tests**,
**51 Socket.IO tests**, **75 focused voice tests**, production build, clean/repeated
compiled migrations, production-process restart smoke and **12 Playwright scenarios**
(4 desktop, 4 tablet, 4 phone). The focused suites are subsets of Vitest.

Browser voice used the explicit synthetic-capture fallback described above; native
WebRTC audio packet transport and playback were verified, native microphone capture
was not. Ready for a controlled single-instance staging deployment with PostgreSQL,
HTTPS/WSS and ICE configuration. Broad production voice reliability still needs
physical-device and TURN/NAT validation. No deployment or infrastructure was
provisioned. See [Phase 9](docs/PHASE_9.md) for exact commands, privacy checks and
remaining limitations.
