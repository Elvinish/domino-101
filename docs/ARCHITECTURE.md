# Domino 101 — Architecture

> **Status:** Design guidance for later phases. The current implementation is described in the root README; this document does not imply those features exist. The latest rebuild request and authoritative game rules take precedence.

> **Goal:** Production-quality architecture without overengineering the MVP.
> **Rule source:** `GAME_RULES.md`
> **Product source:** `PRODUCT_SPEC.md`

## 1. Recommended stack

### Monorepo

- `pnpm` workspaces
- TypeScript across frontend, backend and shared packages

Suggested structure:

```text
domino-101/
├── apps/
│   ├── web/
│   └── server/
├── packages/
│   ├── game-engine/
│   ├── protocol/
│   └── bot-player/
├── docs/
│   ├── GAME_RULES.md
│   ├── PRODUCT_SPEC.md
│   └── ARCHITECTURE.md
├── MASTER_PROMPT.md
├── package.json
├── pnpm-workspace.yaml
└── tsconfig.base.json
```

### Frontend

- React 19
- TypeScript
- Vite 8
- React Router
- Tailwind CSS
- lightweight local UI state
- TanStack Query only where REST/server-query caching is useful
- Socket.IO client for realtime match state
- Zod for runtime boundary validation where appropriate
- i18n library with translation keys

### Backend

- Node.js active LTS
- TypeScript
- Fastify
- Socket.IO
- Zod
- PostgreSQL
- Drizzle ORM

### Testing

- Vitest for unit tests
- game-engine tests with deterministic fixtures
- Fastify integration tests
- Socket.IO multiplayer integration tests
- React Testing Library for critical UI behavior
- Playwright for end-to-end happy path

### Code quality

- ESLint
- Prettier
- strict TypeScript
- no `any` without explicit justification

## 2. Core architectural rule

The application has three separate concerns:

1. **Presentation**
2. **Realtime/application orchestration**
3. **Deterministic Domino domain logic**

Do not mix them.

```text
React UI
   │
   │ typed commands/events
   ▼
Realtime Game Server
   │
   ▼
Pure Game Engine
   │
   ├── match state transitions
   ├── move validation
   ├── scoring
   ├── bağlanma
   └── SEKA
```

Persistence is outside the pure game engine.

## 3. Pure game engine

`packages/game-engine` is the heart of the project.

It must:

- contain no React;
- contain no Socket.IO;
- contain no Fastify;
- contain no database code;
- contain no browser APIs;
- be deterministic when supplied with deterministic shuffle/deal input;
- expose typed state transitions;
- be exhaustively unit tested.

Suggested public concepts:

```text
createMatch
createRound
dealTiles
getLegalMoves
playTile
canPass
passTurn
detectBaglanma
calculateRemainingPoints
resolveRound
applyRoundResult
applySeka
selectNextStarter
checkMatchWinner
```

Do not force these exact function names if a cleaner domain API emerges, but preserve the separation.

## 4. State model

Prefer explicit discriminated unions/state machines over scattered booleans.

Example match phases:

```text
LOBBY
DEALING
PLAYING
ROUND_RESULT
STARTER_SELECTION
MATCH_FINISHED
```

Gameplay command validity depends on phase.

## 5. Server authority

The server owns the canonical state.

Clients send **intent**, not authoritative results.

Good:

```text
PLAY_TILE { tileId, side }
PASS
SELECT_STARTER
SEND_CHAT
```

Bad:

```text
I_SCORED_25
MY_NEW_HAND_IS [...]
TEAM_A_WON
```

The server calculates all results.

## 6. Public vs private state

Never broadcast the complete internal state.

Maintain an internal authoritative state and derive a per-player view.

### Public state may include

- room/match ID;
- seats/names;
- connection state;
- tile counts;
- board chain;
- open ends;
- current turn;
- team scores;
- opened/closed flags;
- pending opening-point totals;
- SEKA Bank;
- round/match phase.

### Private state

For a given client:

- that client's hand;
- that client's reconnect/session data as appropriate.

A client must never receive another player's tile values before they become public on the board.

## 7. Protocol package

Create `packages/protocol`.

It contains shared typed contracts for:

- REST DTOs;
- Socket.IO client → server events;
- Socket.IO server → client events;
- room snapshots;
- public player views;
- private player views;
- errors.

Use Zod schemas at trust boundaries and infer TypeScript types from schemas where practical.

This avoids frontend/backend protocol drift.

## 8. Realtime event design

Prefer commands + authoritative snapshots/patches.

Suggested client commands:

```text
room:create
room:join
room:ready
room:leave

game:play-tile
game:pass
game:select-starter
game:request-rematch

chat:send
reaction:send
```

Suggested server events:

```text
room:snapshot
room:player-joined
room:player-left
room:player-connection

game:snapshot
game:move-applied
game:turn-changed
game:round-ended
game:starter-selection
game:match-ended
game:error

chat:message
reaction:received
```

Do not leak internal engine objects directly across the socket.

## 9. Command idempotency

Realtime clients can retry or reconnect.

Gameplay commands should include:

- `commandId`
- expected match/round identifier
- expected state version where useful

Server should reject:

- duplicate command IDs;
- commands for stale rounds;
- actions from wrong players;
- invalid phase actions.

This prevents accidental double-play from double clicks/retries.

## 10. Versioned game state

Maintain monotonically increasing state version per room/match.

Every authoritative state mutation increments version.

This helps:

- reconnect;
- stale-client detection;
- debugging;
- optimistic UI avoidance.

For MVP, prefer authoritative UI over risky optimistic gameplay.

## 11. Room persistence

Separate durable data from ephemeral realtime state.

### PostgreSQL can persist

- room metadata if needed;
- completed matches;
- match summaries;
- future users/statistics;
- optional recent chat history.

### In-memory server state for MVP

Active room/match state may initially live in server memory if deployment uses one backend instance.

That is acceptable for the first deployed MVP if documented clearly.

### Redis later

Add Redis when needed for:

- multiple backend instances;
- Socket.IO adapter;
- distributed presence;
- shared active-room state;
- horizontal scaling.

Do not introduce Redis before the MVP needs it.

## 12. Database model — minimal MVP

Do not over-model accounts if guest play is the requirement.

Potential tables:

```text
rooms
matches
match_players
match_results
chat_messages   (optional limited history)
```

Active hidden hands should not need to be durably stored in plaintext database rows for the initial MVP.

## 13. Identity and reconnect

MVP guest identity:

- display name;
- server-generated player ID;
- opaque reconnect token.

Reconnect token should be high entropy and treated as secret.

Store client token in browser storage appropriate for the threat model.

Never use display name as identity.

## 14. Shuffle

Use a server-side Fisher-Yates shuffle with a cryptographically secure random source suitable for Node.js.

For tests:

- inject deterministic RNG / fixed deck ordering.

Do not use `Math.random()` as the production authoritative shuffle source.

## 15. Concurrency

Each room must serialize gameplay mutations.

Two simultaneous socket commands must not mutate the same match concurrently.

Implement a simple per-room command queue/mutex or equivalent single-threaded serialized command handling.

Validate state version again inside the serialized operation.

## 16. Error model

Use typed application/domain errors.

Examples:

- `ROOM_NOT_FOUND`
- `ROOM_FULL`
- `INVALID_ROOM_CODE`
- `PLAYER_NOT_IN_ROOM`
- `NOT_YOUR_TURN`
- `ILLEGAL_TILE`
- `ILLEGAL_SIDE`
- `PASS_NOT_ALLOWED`
- `INVALID_PHASE`
- `STARTER_NOT_ELIGIBLE`
- `STALE_GAME_STATE`
- `RATE_LIMITED`

UI maps these to localized user-facing messages.

## 17. Frontend feature architecture

Suggested:

```text
apps/web/src/
├── app/
├── pages/
├── features/
│   ├── room/
│   ├── game/
│   ├── chat/
│   ├── reactions/
│   └── settings/
├── entities/
│   ├── player/
│   ├── domino/
│   └── team/
├── shared/
│   ├── api/
│   ├── socket/
│   ├── ui/
│   ├── lib/
│   ├── i18n/
│   └── styles/
└── main.tsx
```

React components should not contain Socket.IO calls directly.

Use feature/model hooks/services to connect transport to UI.

## 18. Backend layers

Suggested:

```text
apps/server/src/
├── app/
├── config/
├── http/
│   ├── routes/
│   └── controllers/
├── realtime/
│   ├── handlers/
│   ├── rooms/
│   └── middleware/
├── services/
├── repositories/
├── db/
├── security/
├── observability/
└── server.ts
```

Rules:

- HTTP controllers are thin.
- Socket handlers parse/authorize then call services.
- Services orchestrate rooms and game engine.
- Repositories perform persistence.
- Game rules stay in `packages/game-engine`.

## 19. Chat architecture

Chat is room-scoped, not part of the game engine.

Validate:

- player belongs to room;
- max message length;
- rate limit;
- normalized plain text.

Broadcast sanitized text only.

## 20. Testing bot architecture

Bots are test clients, not special game-engine actors.

Create a dedicated package or server-side module, for example:

```text
packages/
  bot-player/
```

or:

```text
apps/server/src/bots/
```

Recommended separation:

```text
Game Engine
    ↑
Game Service
    ↑
Player Command Interface
   ↑          ↑
Human       Bot Driver
Socket
```

A bot must submit the same domain commands a human player would submit.

Bots must not:

- mutate match state directly;
- bypass command validation;
- access hidden opponent hands;
- calculate authoritative round results;
- receive privileged game state.

A bot receives only the same authorized player view that its seat would receive.

### Bot strategy interface

Use a small interface such as:

```text
BotStrategy
  chooseMove(playerView, legalMoves)
  chooseStarter(...)
```

The first implementation should be a deterministic heuristic bot.

Suggested behavior:

1. obtain legal moves from authoritative game logic;
2. if none exist, issue `PASS`;
3. otherwise prefer a legal move using a simple stable heuristic;
4. break ties using seeded deterministic randomness when required.

Do not build an LLM-powered bot.

### Bot modes

Support:

- one human + three bots;
- two humans + two bots;
- four bots;
- replace/remove a bot while still in lobby;
- deterministic simulation tests.

### Simulation runner

Provide a non-UI test/simulation utility capable of running many bot-only matches.

Use it to detect:

- illegal state transitions;
- deadlocks;
- infinite rounds;
- invalid pass behavior;
- score-opening bugs;
- SEKA Bank bugs;
- bağlanma edge cases;
- starter-selection problems.

Allow a deterministic seed to reproduce a failed match.

Example report:

```text
seed: 18472
matches: 1000
completed: 1000
deadlocks: 0
illegalTransitions: 0
```

This simulation runner is a quality tool and should be runnable from the command line.

## 27. Voice architecture — later

Voice is a separate feature.

Do not route audio through the Node.js gameplay server.

Use WebRTC.

For a four-player MVP voice experiment, mesh may be acceptable. For larger reliability/scaling needs, use an SFU/service.

Voice signaling may use the realtime server, but audio media transport remains separate.

## 21. Deployment model

Initial production deployment can be:

```text
Browser
  ├── static frontend
  └── HTTPS/WSS
        ↓
Single Node/Fastify/Socket.IO server
        ↓
PostgreSQL
```

Use a host that supports long-lived WebSocket connections.

Frontend may be hosted separately or served by the backend.

For MVP, one server instance is deliberately preferred because active game state can remain simple.

Later:

```text
Load Balancer
   ↓
Multiple game servers
   ↓
Redis adapter/state coordination
   ↓
PostgreSQL
```

## 22. Environment configuration

Use validated environment variables.

Examples:

```text
NODE_ENV
PORT
DATABASE_URL
WEB_ORIGIN
LOG_LEVEL
```

No secrets committed to git.

Provide `.env.example`.

## 23. Observability

Structured logs:

- request/event type;
- room ID;
- match ID;
- player ID where safe;
- state version;
- latency;
- error code.

Never log:

- reconnect tokens;
- full hidden hands in production;
- secrets.

## 24. Testing strategy

### Highest priority: game engine

Game rules are more important than visual polish.

Write tests directly from `GAME_RULES.md`.

### Integration

Simulate four connected clients:

- create/join room;
- ready;
- deterministic deal;
- turn progression;
- legal move;
- illegal move rejection;
- pass;
- round completion;
- reconnect;
- chat;
- starter selection.

### E2E

At least:

1. four browser contexts join one room;
2. match begins;
3. several moves are played;
4. one client refreshes and reconnects;
5. hidden hands remain private;
6. match can reach a round result.

## 25. Development order

1. Repository/monorepo foundation.
2. Domain types.
3. Pure game engine.
4. Rule unit tests.
5. Deterministic testing bot + simulation runner.
6. Realtime protocol schemas.
7. Room/lobby server.
8. Four-client integration tests.
9. Basic playable UI.
10. Reconnect.
11. Complete scoring UI.
12. Chat/reactions.
13. Design polish/animations/sounds.
14. Deployment.
15. Voice in Phase 9, after persistence and production readiness.

Do not build voice before the base game is stable.

## 26. Definition of done for MVP

- Four remote users can join one private room.
- All 28 tiles are dealt correctly.
- Hidden information is private.
- Server validates every game action.
- All approved scoring rules work.
- SEKA and SEKA Bank work.
- Pending opening points work and burn correctly.
- Bağlanma works.
- `0:0` special case works.
- Winner at `>=101` works.
- Winning team controls next starter.
- Refresh/reconnect works.
- Chat works.
- Desktop and mobile are usable.
- Unit/integration/E2E test suite passes.
- Production build passes.
- App can be deployed behind HTTPS/WSS.
