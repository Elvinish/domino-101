# Phase 3 — typed multiplayer protocol and authoritative rooms

## Scope and structure

Four real Socket.IO clients can create/join a private room, start a match, receive
separate private hands and shared state, and play through match completion. The
Phase 2 engine, game rules, and Phase 2A bot implementation/tests are unchanged.
The React app is still a boot screen. There is no persistence or reconnect yet.

| Location                               | Responsibility                                                                              |
| -------------------------------------- | ------------------------------------------------------------------------------------------- |
| `packages/protocol/src/multiplayer.ts` | Event constants, strict Zod payload/response schemas and shared TypeScript event interfaces |
| `apps/server/src/realtime/socket.ts`   | Socket.IO attachment, boundary parsing, per-socket emission and shutdown                    |
| `apps/server/src/rooms/service.ts`     | Membership, lifecycle, authorization, revisions, bounded command history                    |
| `apps/server/src/rooms/queue.ts`       | Per-room serialized asynchronous executor                                                   |
| `apps/server/src/rooms/projections.ts` | Explicit public and player-specific output allow-lists                                      |
| `apps/server/src/rooms/shuffle.ts`     | Server-side cryptographic Fisher–Yates deal order                                           |
| `apps/server/src/rooms/types.ts`       | Internal room, player and connection structures                                             |
| `apps/server/src/rooms/errors.ts`      | Stable safe error mapping                                                                   |
| `apps/server/src/__tests__/`           | Actual Socket.IO clients, adversarial tests, complete bot-assisted match                    |

Socket.IO 4.8.4 attaches to the same HTTP server as Fastify. `createApp` constructs
without listening and accepts trusted test-only constructor options for deterministic
decks/resource limits. No client can supply a deck, seed, identity or server option.
Fastify's `preClose` disconnects clients, drains room queues, clears memory and closes
Socket.IO; process signal handling stays in the existing entry point.

## Protocol

Import constants and types from `@domino/protocol`; do not invent separate wire
contracts in clients. Incoming objects and nested actions are strict Zod objects:
unknown fields are rejected, including player/seat/team/hand/score claims.

| Client event   | Payload                                            |
| -------------- | -------------------------------------------------- |
| `room:create`  | `{ displayName }`                                  |
| `room:join`    | `{ roomId, displayName }`                          |
| `room:start`   | `{ roomId }`                                       |
| `game:command` | `{ roomId, commandId, expectedRevision, command }` |

Gameplay `command` is one of:

```ts
{ type: 'play', tile: '1:2', end?: 'start' | 'left' | 'right' }
{ type: 'pass' }
{ type: 'select-starter', selected?: 0 | 1 | 2 | 3 }
{ type: 'next-round' }
```

`selected` names the proposed starter, never the sender's identity. The service
gets the actor's seat from the current socket membership. The engine validates
both starter eligibility and all gameplay legality. An omitted placement end is
permitted by the schema so the engine preserves its `END_REQUIRED` error for an
ambiguous move. Projected legal placements always supply an explicit end.

Each request supports an optional Socket.IO acknowledgement callback. The same
safe result is also emitted through `command:result`, so requests without callbacks
still have a response:

```ts
{ ok: true, roomId, revision, commandId? }
{ ok: false, error: { code }, commandId? }
```

Only validated gameplay requests include a `commandId` in their results. Malformed
requests do not echo untrusted values or Zod error details. Every failure also emits
`server:error` with `{ event, code, commandId? }`. Unsupported gameplay command
shapes are `INVALID_PAYLOAD`; unknown non-protocol event names are ignored.

| Server event     | Contents                                                                                             |
| ---------------- | ---------------------------------------------------------------------------------------------------- |
| `room:joined`    | Assigned `roomId`, `playerId`, `seat`, only to that joining socket                                   |
| `room:snapshot`  | Room ID, host ID, revision, lifecycle, pause flag, four public seat slots                            |
| `game:snapshot`  | Room/match IDs, revision, recipient identity/seat, `public` game, recipient's `private` hand/actions |
| `command:result` | Safe success/failure envelope                                                                        |
| `server:error`   | Stable error code and request event                                                                  |

Codes include invalid payload, missing/full/not-ready/already-started rooms, existing
membership, nonmember, nonhost, stale revision, conflicting command ID, invalid phase,
wrong turn, unowned/illegal tile, invalid/ambiguous end, illegal pass, ineligible
starter, server busy and internal error. Unexpected errors never expose raw messages
or authoritative state.

## Room lifecycle and identity

A room code is its 128-bit cryptographically random 32-character lowercase hex ID,
suitable for a future share URL. Player and match IDs are server-generated UUIDs.
Names are trimmed, 1–32 UTF-16 code units, with control/format characters rejected.
Names are display text, not unique identifiers or authentication credentials.

- Creation seats the host at 0. Joins fill the lowest available slot through 3.
- One current socket has at most one room membership. Duplicate joins/creates are
  rejected even when membership attempts target different rooms concurrently.
- Teams come from the engine: A = 0/2; B = 1/3.
- Only the host may start, and all four slots must be occupied and connected.
- A room moves `lobby → playing → completed`. Engine `round-ended` and
  `starter-selection` are phases inside the room's `playing` lifecycle.
- Only the host submits `next-round` after an engine round result. The engine deals
  and decides whether starter selection is required or SEKA keeps the starter.
- Eligible winning-team partners select a starter through normal engine commands.
- Duplicate starts and all joins after leaving the lobby are rejected. There are no
  rematches, spectators, matchmaking or account identity in this phase.

## Revision, idempotency and serialization

The room revision starts at **1** when its creator joins. Each successful join,
start, gameplay transition, or visible disconnect increments it once. Revision is
room-wide and never resets at a new round. Public room and private game snapshots
carry the same revision. Failed commands and duplicate replays do not increment it.

Gameplay uses a UUID `commandId` and `expectedRevision`. Inside the room queue:

1. Validate that the socket is still connected and owns that room/player binding.
2. Check that player's retained command ID and normalized parsed payload.
3. Replay the identical prior result, or reject conflicting reuse explicitly.
4. For a new ID, validate current revision, room readiness and host-only operations.
5. Call the engine, commit the returned state and increment revision once.
6. Retain the result, then publish safe snapshots from inside the serialized task.

Both successful and authorized failed gameplay attempts are retained in a **FIFO
window of 128 IDs per player**, at most 512 per full room. Cache hits do not refresh
FIFO age. Conflicting content includes changing the expected revision. To submit
corrected intent after an error, use a new command ID. Old successful IDs replay
the original acknowledgement revision, not a new state update; clients must never
roll back their latest snapshot to an older acknowledged revision.

Once an ID is evicted, old original content is rejected by its stale revision. An
evicted ID reused with a new current revision is treated as new intent. This is a
bounded idempotency window, not permanent exactly-once delivery. Creation/join/start
use membership/lifecycle guards rather than the gameplay command cache.

Every existing-room mutation, including disconnects, runs in that room's FIFO
`SerialQueue`. Validation occurs inside the queue, not before waiting. A failed task
does not poison later work. Different rooms have independent queues. Mutation bodies
are synchronous, so cross-room membership checks and assignment cannot interleave
partway through a membership change. No process-wide game lock is used.

Ordinary queued work is limited to 128 pending operations per room. Essential
disconnect cleanup remains admissible. At most 1,000 rooms are retained per server.
These are resource bounds, not a complete production abuse/rate-limiting policy.

## Projections and privacy

There is no full-state broadcast and no generic object-spread serialization of a
Room/Player/Match. The public projection lists only approved fields. Per-recipient
projection adds exactly that seat's hand and legal actions. Legal actions are derived
from the engine for the current player; others get none unless they are eligible
for starter selection or host-controlled next round. Paused rooms offer no actions.

Shared state includes oriented played tiles/open ends, turn/starter, phase/round,
counts, scores/opening/pending/SEKA counters, eligible team and public result totals.
It never includes unplayed opponents' or partners' tile values, even after a round
or match completes. Socket IDs, command caches and the internal match state are not
DTO fields. Outbound schemas are strict and parsed before emission.

For every update the transport enumerates the authoritative seat bindings and
emits a separately constructed `game:snapshot` to each connected socket. There is
no broadcast of a universal private object. The production server never imports
bot strategy code; integration clients use bot strategies against only wire views.

## Disconnect limitations

- In a lobby, disconnect releases the seat. If the host left, the lowest remaining
  occupied seat becomes host. A replacement gets a fresh server identity.
- After start, the identity/seat remains reserved and is marked disconnected. The
  room pauses all game commands with `ROOM_NOT_READY`; hidden hands remain intact.
- New sockets cannot reclaim the identity, replace the seat or join the active room.
  Live socket ownership is checked even before a cached command result is replayed.
- There are **no reconnect tokens**, takeover paths, forfeits or automatic bots.
  A paused active room cannot resume in Phase 3; players need a fresh room.
- When everyone disconnects, the room and its state are deleted. Otherwise room
  memory lasts until all players leave or the process stops. No persistence or TTL
  background job was added.

## Transport/configuration/logging

The existing health endpoint remains unchanged. `WEB_ORIGIN` defaults to
`http://localhost:5173` and must be one exact HTTP(S) origin without a path or
credentials. Socket.IO CORS and the handshake origin check cover browser polling
and WebSocket requests. Origin-less native clients are intentionally allowed for
QA; origin filtering is not user authentication. Knowing a share code permits a
guest to join an available lobby seat.

Incoming Socket.IO messages are capped at **8 KiB**. Oversized packets disconnect
the offending client. Smaller malformed messages produce safe structured errors.
Socket.IO client bundle serving is disabled. Application logs contain only fixed
event/code fields on internal failures; they never log payloads, validation issues,
private hands, names, full state or raw exception objects. Existing Fastify request
logging stays disabled. Do not enable dependency packet-level debug logging around
private gameplay data.

## Verification

Final verification used Node.js 24.21.0 and pnpm 10.34.5:

- Frozen-lockfile offline installation: passed; lockfile up to date.
- Prettier: passed across the repository.
- ESLint: passed with zero warnings allowed.
- Full TypeScript typecheck: passed for all workspaces, tests and tool configuration.
- Full Vitest: **284 tests passed in 19 files**, zero failures (53.75 seconds).
- Dedicated Socket.IO integration: **25 tests passed in 2 files**, zero failures
  (688 milliseconds). These tests also passed within the full suite.
- Production build: passed for all three shared packages, Fastify server and Vite web app.

`pnpm verify` completed successfully. Browser E2E and cross-machine/production
network behavior were not verified in this backend-only phase.

Automated coverage includes schema attacks, server-assigned identity, room capacity,
host restrictions, engine legality, ambiguity, stale/conflicting/duplicate commands,
FIFO eviction, cross-room attempts, a disconnected socket queued behind other work,
room independence, private per-player emissions, paused seats, lobby cleanup,
WebSocket and polling, Origin rejection, oversized packets, sanitized logs and
shutdown with connected clients.

A complete real-network test drives four Socket.IO clients through multiple rounds,
starter selection and match completion using `chooseCommand` from the bot package.
It never calls engine transitions on behalf of those clients. Every outbound event
is checked against its strict schema and current opponent hidden tiles at every
revision, including round and match result states.

The sandbox initially rejected listening with `listen EPERM: operation not permitted
127.0.0.1`. The real integration tests were then run with the required localhost
permission; no mocked substitute or skipped tests were used.

## Deferred / readiness

No React gameplay UI, browser E2E, database, persistence, reconnect, chat, reactions,
voice, matchmaking, accounts, Redis, multi-server coordination or deployment was
implemented. Production HTTPS/WSS, hosting, broader rate limiting and cross-machine
network validation remain later work. This is a verified backend foundation for
Phase 4, not a deployable complete multiplayer product.

Stop after Phase 3. Phase 4 requires explicit instruction.
