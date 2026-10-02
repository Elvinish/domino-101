# Phase 8 — PostgreSQL/Drizzle persistence and restart recovery

## Scope and important files

Phase 8 adds durable authoritative room, match, guest reconnect and bounded chat
state. Game rules, private projections, wire schemas, React UI, localization,
accessibility and sound behavior remain unchanged. Phase 9 voice chat is not
implemented. There is no new authentication, hosting, TURN, Redis or distributed
coordination.

| File                                                                 | Responsibility                                              |
| -------------------------------------------------------------------- | ----------------------------------------------------------- |
| `apps/server/src/db/schema.ts`                                       | Typed Drizzle tables, foreign keys, indexes and checks      |
| `apps/server/drizzle/`                                               | Generated SQL migration, journal and schema snapshot        |
| `apps/server/src/db/migrate.ts`                                      | Development and compiled production migration entry point   |
| `apps/server/src/persistence/types.ts`                               | Explicit versioned repository boundary                      |
| `apps/server/src/persistence/codec.ts`                               | Strict stored-data parsing and engine invariant validation  |
| `apps/server/src/persistence/postgres.ts`                            | PostgreSQL transactions, recovery reads and cleanup         |
| `apps/server/src/rooms/service.ts`                                   | Staged room mutations, commit ordering, recovery and expiry |
| `apps/server/src/chat/service.ts`                                    | Atomic bounded history, rate windows and social idempotency |
| `apps/server/src/realtime/socket.ts`                                 | Startup/shutdown integration and safe diagnostics           |
| `apps/server/src/__tests__/persistence.postgres.integration.test.ts` | Real PostgreSQL and server lifecycle verification           |
| `apps/server/src/rooms/persistence.test.ts`                          | Delayed/rejected/uncertain commit fault injection           |
| `apps/server/src/persistence/codec.test.ts`                          | All engine phases, corruption and privacy boundaries        |

The installed/lockfile versions are Drizzle ORM 0.45.3, Drizzle Kit 0.31.11 and
node-postgres 8.23.1. The database layer is server-only; engine and protocol
packages have no database dependency.

## Schema and versioning

`PersistenceStore` accepts explicit serializable aggregates rather than runtime
room objects. Persistence version 1 is validated on both writes and reads.

- `room_records`: primary room ID, host, lifecycle, safe-integer revision,
  match ID, authoritative engine JSON, persistence version, created/updated times
  and optional offline expiry. The expiry column is indexed.
- `room_players`: room/player identity, display name, unique seat and nullable
  SHA-256 reconnect-token hash. Four seats are enforced through seat-range and
  uniqueness constraints. No socket identifier is stored.
- `room_commands`: per-player command UUID, SHA-256 payload fingerprint, bounded
  insertion position and safe result. Composite foreign keys cascade from players.
  At most 128 records per current player are written/restored.
- `room_chat`: one versioned JSON aggregate per room containing at most 50 recent
  messages, 128 chat and 128 reaction results per player (1,024 total maximum),
  and four rate windows. The row cascades from the room.

Room/player rows provide simple identity and cleanup constraints. The engine
aggregate stays together as JSON so tiles, scores, opened states, pending opening
points, seka bank, turn, round result, starter selection and match completion can
be validated together without reimplementing Domino rules in SQL.

The strict codec rejects unknown fields/versions, incomplete matches, duplicate
seats or identities, missing hosts, inconsistent lifecycle, invalid command
results and oversized histories. Every restored engine state also passes the
engine's existing invariant validator. All four engine phases are round-tripped
in tests. Stored rows are never emitted directly as public API data.

## Commit ordering and failure behavior

The existing per-room serial queue covers game, membership and social operations.
Authorization is rechecked inside the queue, including current socket ownership;
cross-room claims reserve a socket while an asynchronous join/create/reconnect
write is pending.

1. Validate current membership, command identity and expected revision.
2. Stage a copy of the room/memberships/command map and run the engine mutation.
3. Commit room, membership and game-command records in one Drizzle transaction.
4. Replace the live state/bindings, update expiry timers, then broadcast and return
   success. No network work runs inside a database transaction.

Chat commits message/history, command result and rate limit state with one atomic
JSON row upsert before delivery. Reactions themselves remain ephemeral; only their
bounded command results are retained to prevent replay after restart.

Invalid or stale game commands do not change match state, revision, timestamps,
memberships or broadcast state. To retain the existing stable failure/retry
semantics, their safe result and hashed fingerprint are persisted as idempotency
metadata. Identical retained retries and conflicting duplicates do not write
anything. Unauthorized requests never enter the command history.

Any rejected persistence write is treated as potentially uncertain: the affected
room is locked until restart/recovery, returns a safe error, and publishes no new
successful state. Already queued requests also recheck the lock. Other rooms can
continue. Disconnect, expiry and shutdown must not overwrite an uncertain commit
with older RAM. On restart, PostgreSQL determines the recovered state, including a
commit whose acknowledgement was lost. Tests cover both rollback and that
ambiguous outcome.

An unavailable database, migration failure, unsupported version or corrupt stored
room/chat prevents startup readiness and listening. Raw driver/Zod exceptions are
not logged by the application. Safe diagnostics use error codes, event names and
room IDs. `/health` remains a process liveness check; it is not a continual
database probe. The pool uses bounded connections and query/connect timeouts and
closes on application shutdown.

## Recovery, reconnect and expiry

Startup applies migrations, deletes expired rows, validates recoverable rooms and
chat, reconstructs queues and maps, and reserves each stored seat as disconnected.
Old sockets are never restored or trusted. Engine state and revision are preserved
exactly during recovery. A valid token proves ownership of the same player/seat;
the existing reconnect operation increments the revision as a disconnected seat
becomes connected. A connected replacement retains the existing revision semantics
and immediately invalidates old socket ownership.

Active matches remain paused until all four players return. On successful
reconnect, only that player's private hand is projected. Bounded game/social
command results survive restart, including exact original acknowledgement
revisions. Conflicting command ID reuse is rejected. Beyond the 128-entry window,
game commands still require the current revision; chat deduplication is explicitly
bounded rather than an unlimited archive.

All-offline rooms expire after 30 minutes by default. Disconnect and graceful
shutdown persist the deadline. A crash with previously connected players receives
a recovery deadline at the next startup; it is persisted once so subsequent
restarts cannot extend it. Runtime timers and startup expiry cleanup delete the
room with cascading dependent rows. No separate job service is needed. Expired
rows while the server is stopped are cleaned on its next startup.

Explicit leave still releases a lobby seat or revokes an active-match reconnect
hash while reserving that seat, following Phase 5. Trusted internal QA bot seats
have no human reconnect token and are not automatically respawned after restart;
the production room UI continues to use four human guests.

## Setup and migration commands

Use PostgreSQL mode for durable development or production. Memory mode remains
the default for ephemeral local work; production explicitly rejects it.

```sh
cp .env.example .env
# Set POSTGRES_PASSWORD to your own password in the ignored .env file.
# Set PERSISTENCE_MODE=postgres and DATABASE_URL using that password.
# URL-encode reserved password characters in DATABASE_URL.
docker compose up -d postgres
pnpm db:migrate
pnpm dev
# Stop the local database while retaining its named volume:
docker compose down
```

Compose contains PostgreSQL 18.6 only, exposes it on loopback, uses the PostgreSQL
18 volume layout and requires a user-supplied password. There are no embedded
credentials. An existing PostgreSQL installation can be used instead of Docker.

`pnpm db:generate` uses `drizzle.config.ts` to generate SQL, a journal and a schema
snapshot. The checked-in initial migration is `0000_phase8_persistence.sql`.
`pnpm db:migrate` applies it using the same initialization path as startup.
After `pnpm build`, `pnpm --filter @domino/server db:migrate:production` runs the
compiled migration entry point. Deployment artifacts must include
`apps/server/drizzle/` next to `apps/server/dist/` and installed runtime dependencies.
Migrations are repeatable; no manual table editing is required.

## Privacy and database operations

The database stores SHA-256 hashes of cryptographically generated reconnect tokens,
never raw tokens, socket IDs or database credentials. Command fingerprints are
hashes rather than payload copies, so trimming chat to 50 messages does not retain
older plaintext in an idempotency archive. SQL is parameterized through Drizzle.
Public/private projections retain their explicit allowlists; database-only fields
do not enter socket events. Real database tests inspect rows for tokens/socket IDs
and audit every recovered player's payload for other players' hidden tiles.

Authoritative hands necessarily exist in private database rows. Chat and display
names are also persisted. Restrict database and backup access, use appropriate
transport encryption, and do not enable SQL parameter/state dumping in database
or infrastructure logs. Application failure messages deliberately omit private
data. Expiry is logical deletion; PostgreSQL WAL/backups follow the operator's
retention policy rather than promising immediate physical erasure.

## Verification record — 2026-10-02

Real PostgreSQL 18.6 was downloaded from the official PostgreSQL source release,
SHA-256 verified, compiled and installed under `/private/tmp/domino-phase8-postgres`.
Docker was not installed and local Homebrew did not support this macOS version.
The isolated native cluster listened only on `127.0.0.1:55438`, using disposable
test databases. The local test build omitted ICU, readline and zlib; it was not a
production database installation. No cloud database or hosting was provisioned.

| Check                                     | Result                                                                                                          |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `pnpm install --frozen-lockfile`          | Passed, pinned pnpm 10.34.5 / Node 24                                                                           |
| Prettier write + check                    | Passed; all matched files formatted                                                                             |
| ESLint, zero warnings                     | Passed                                                                                                          |
| Full workspace/tools/E2E TypeScript       | Passed, including all added tests                                                                               |
| Full Vitest with `TEST_DATABASE_URL`      | **426 passed, 35 files, 0 failed, 0 skipped**                                                                   |
| `pnpm test:postgres`                      | **14 passed, 1 file; real PostgreSQL, no skips**                                                                |
| `pnpm test:socket`                        | **44 passed, 4 files**                                                                                          |
| `pnpm build`                              | Passed for all shared packages and both production apps                                                         |
| Empty-database `pnpm db:migrate`          | Passed on a separate fresh database                                                                             |
| Compiled production migration command     | Passed; repeat application was safe                                                                             |
| `pnpm db:generate` after generation       | No schema changes; migration metadata matches schema                                                            |
| `pnpm test:e2e`                           | **9 passed: desktop 3, tablet 3, phone 3**                                                                      |
| Compiled production process restart smoke | Passed; two processes, four real clients, five moves, exact state recovery, continued play, clean SIGTERM exits |

The PostgreSQL suite covers migrations, identities/hash privacy, several moves,
reconnect of all four players, identical state/revision recovery, stale sockets,
cross-room rejection, nonzero scoring, starter-selection and completed-match
recovery, persisted failure results, retry/conflict handling, an injected real
transaction rollback, 50-message history and 128-command eviction, rate-limit
recovery, cascading expiry, repeated recovery deadlines, corrupt versions/engine/
chat, and unavailable database startup. Fault-injection unit tests additionally
hold writes open, fail each membership operation and simulate an uncertain commit.

Set `TEST_DATABASE_URL` in the test shell to a **dedicated disposable database
whose name ends in `_test`**. Tests delete its room data. `pnpm test:postgres`
fails without this variable. The default full Vitest suite explicitly skips the
PostgreSQL file when it is absent; a skipped database suite is not verification.
Test URLs are not loaded automatically from `.env`.

## Unverified environments and production limits

- Exactly one application instance owns a database. No multi-instance/rolling
  deployment, distributed locks, Redis or concurrent migration orchestration.
  Stop the old instance before starting its replacement.
- HTTPS/WSS, exact origin configuration, PostgreSQL availability, schema/migration
  privileges, private database access, backups/restore, monitoring and deployment
  management are operator requirements. None were provisioned or production-tested.
- Browser tests use production-built apps with ephemeral memory rooms. Restart
  orchestration is tested with actual Fastify/Socket.IO instances against PostgreSQL
  and separately with compiled server processes. Playwright's managed web-server
  fixture does not expose a restart control; no test-only restart endpoint was
  added to production code. Browser reconnect/refresh/replacement flows all passed.
- Chromium desktop/tablet/phone emulation passed. Physical devices, Safari,
  Firefox, real network failures, PostgreSQL TLS/failover, backup restoration,
  power-loss behavior and Docker Compose execution were not verified here.
- No Git repository exists in the supplied workspace, so migration files and
  code are present on disk but no commit could be created.

Phase 8 is complete and ready for Phase 9. Voice chat remains deferred until
separately authorized. The temporary PostgreSQL server was stopped after
verification. Deployment readiness depends on the operational requirements above;
this work does not claim a production deployment exists.
