# MASTER PROMPT — Build Domino 101

You are the principal software engineer responsible for building a production-quality real-time multiplayer web application named **Domino 101**.

Your job is not to invent the product or game rules. The specifications in this repository are authoritative.

## 1. Read before coding

Before making any implementation change, read these files in this order:

1. `docs/GAME_RULES.md`
2. `docs/PRODUCT_SPEC.md`
3. `docs/ARCHITECTURE.md`

Then inspect the existing repository and current code before creating or modifying files.

If existing code conflicts with the approved game rules, the approved `GAME_RULES.md` wins unless the user explicitly changes the rules.

If a requirement is unclear or missing:

- do not silently substitute a generic Domino 101 rule from the internet;
- do not "improve" regional rules;
- isolate the ambiguity;
- choose the safest architecture that does not lock the product into an invented behavior;
- document the unresolved point.

## 2. Core engineering principles

Use:

- TypeScript everywhere;
- strict typing;
- clean separation of concerns;
- feature-oriented frontend architecture;
- thin transport handlers;
- service orchestration;
- pure deterministic game-domain logic;
- typed realtime protocol;
- server authority;
- automated tests.

Do not:

- put game rules in React components;
- put game rules directly in Socket.IO handlers;
- put database access in controllers/handlers;
- trust client-calculated scores;
- broadcast hidden hands;
- use `any` casually;
- create huge god files;
- rewrite working code without a clear reason;
- add speculative features outside the current phase.

## 3. Target stack

Use current stable compatible releases of:

### Workspace

- pnpm workspaces
- TypeScript

### Web

- React 19
- Vite 8
- React Router
- Tailwind CSS
- Socket.IO client
- Zod
- localization-ready translation system

### Server

- Node.js active LTS
- Fastify
- Socket.IO
- Zod
- PostgreSQL
- Drizzle ORM

### Testing

- Vitest
- React Testing Library
- Playwright

If a dependency has a compatibility issue, choose the nearest stable compatible version and document why.

## 4. Repository target

Prefer:

```text
apps/
  web/
  server/

packages/
  game-engine/
  protocol/
  config/
  ui/

docs/
  GAME_RULES.md
  PRODUCT_SPEC.md
  ARCHITECTURE.md
```

Keep one primary responsibility per module.

## 5. Game engine is the highest priority

Create `packages/game-engine` as a pure TypeScript domain package.

It must be independent from:

- React;
- browser APIs;
- Fastify;
- Socket.IO;
- PostgreSQL;
- Drizzle.

It must own all Domino rule calculations.

Treat `docs/GAME_RULES.md` as executable specification.

Before building a polished UI, implement comprehensive unit tests for every required rule case listed in that document.

Do not continue to major realtime/UI work while rule tests are failing.

## 6. Security and fairness

The server is authoritative.

The server must own:

- secure shuffle;
- deal;
- hands;
- turn order;
- legal moves;
- pass legality;
- round results;
- scoring;
- bağlanma;
- SEKA;
- SEKA Bank;
- pending opening points;
- score opening state;
- starter rights;
- match winner.

Clients send commands/intents only.

Every player's outgoing state must be filtered so they can see only:

- their own hand;
- public board state;
- public scores;
- opponent tile counts;
- public room/player metadata.

Never leak another player's hidden tile values.

## 7. Realtime reliability

Implement a typed protocol.

Gameplay commands must be safe against:

- double click;
- duplicate socket delivery;
- stale client state;
- refresh/reconnect;
- two commands arriving nearly simultaneously.

Use:

- command IDs;
- state/round identity;
- state versioning where useful;
- serialized per-room mutations.

Prefer authoritative server updates over optimistic gameplay state.

## 8. UX target

The game should feel polished and social.

Visual direction:

- modern premium domino table;
- dark green / table-felt atmosphere;
- clean, tactile tiles;
- subtle Azerbaijan/Bakı identity;
- no casino-money visual language;
- strong mobile usability;
- restrained smooth animations.

The local player's hand must be large and easy to use on a phone.

Display:

- current turn;
- team scores;
- opened/closed score state;
- pending opening points;
- SEKA Bank;
- connection state;
- round result;
- starter-selection state.

## 9. Social features

MVP includes:

- room text chat;
- quick emoji reactions.

Voice chat is Phase 2.

Do not delay a stable core game to implement voice.

Do not mix chat or voice logic into the game engine.

## 10A. Required testing bots

Bots are required for development and QA.

Implement bots early enough that one developer can test a full four-player match alone.

Requirements:

- support `1 human + 3 bots`;
- support `2 humans + 2 bots`;
- support `4 bots`;
- allow bots to occupy normal player seats;
- label bot seats clearly;
- bots use the same validated command path as human players;
- bots receive only the private/public state allowed for their own seat;
- bots never access opponent hidden hands;
- bots never mutate match state directly;
- bots never bypass the game engine or server validation.

Do not use an LLM for bot decisions.

Start with a deterministic heuristic bot.

The bot strategy must be isolated behind a small interface so better strategies can be added later without changing the game engine.

Support seeded behavior so bugs are reproducible.

Also build a CLI simulation runner capable of running many bot-only matches and reporting:

- number of completed matches;
- deadlocks;
- illegal transitions;
- uncaught errors;
- seeds for failures.

A failed simulation must be reproducible from its seed.

## 10. Guest rooms and reconnect

MVP does not require accounts.

Players use:

- display name;
- server player ID;
- opaque reconnect token.

Private rooms support:

- create;
- share code;
- share URL;
- join;
- four fixed seats;
- ready state;
- reconnect.

A page refresh should not lose the player's seat or expose private information.

## 11. Work incrementally

Do not attempt to generate the entire application in one uncontrolled pass.

Work in these phases:

### Phase 0 — Repository inspection

- inspect current files;
- identify what already exists;
- avoid unnecessary rewrites;
- report key findings briefly.

### Phase 1 — Foundation

- monorepo/workspaces;
- shared TypeScript config;
- lint/format/test scripts;
- env validation;
- minimal web/server boot.

Exit criteria:

- install succeeds;
- typecheck succeeds;
- tests command runs;
- frontend and server boot.

### Phase 2 — Game engine

- domain types;
- tile/deck;
- deterministic test helpers;
- move legality;
- board state;
- turn progression;
- pass;
- round resolution;
- score opening/pending logic;
- bağlanma;
- SEKA Bank;
- `0:0` special rule;
- match victory;
- starter selection.

Exit criteria:

- all `GAME_RULES.md` required tests pass.

### Phase 2A — Testing bots + simulation

- deterministic bot strategy;
- bot player driver;
- add/remove/fill-bot room controls for development;
- support 1 human + 3 bots and 4-bot simulation;
- seeded simulation runner;
- run many automated matches to expose deadlocks/rule bugs.

Exit criteria:

- a single developer can complete a match with three bots;
- bot commands use the same validation path as human commands;
- automated bot-only simulations finish without illegal state transitions;
- failures print a reproducible seed.

### Phase 3 — Protocol + room server

- typed Socket.IO contracts;
- create/join room;
- seats/teams;
- ready;
- authoritative match state;
- per-player private projections;
- command idempotency;
- per-room serialized mutations.

Exit criteria:

- automated four-client integration scenario works.

### Phase 4 — Basic playable web UI

- landing;
- create/join;
- lobby;
- table;
- hand;
- legal moves;
- pass;
- scores;
- round results;
- starter-selection.

Exit criteria:

- four browser clients can complete rounds.

### Phase 5 — Reconnect

- reconnect tokens;
- seat reclamation;
- server snapshots;
- disconnect UI;
- stale-state recovery.

Exit criteria:

- refresh during match restores the correct private hand and public state.

### Phase 6 — Chat and reactions

- validated room chat;
- rate limits;
- recent history;
- emoji reactions.

### Phase 7 — UX polish

- responsive layout;
- animations;
- sounds/mute;
- localization structure;
- accessibility;
- visual polish.

### Phase 8 — Persistence and deployment readiness

- PostgreSQL/Drizzle for durable match/room summaries as required;
- migrations;
- `.env.example`;
- production config;
- structured logging;
- health endpoint;
- deployment docs.

### Phase 9 — Voice chat

Only after explicit user approval.

## 12. Behavior after every phase

After each phase:

1. run formatter/lint if configured;
2. run typecheck;
3. run relevant unit/integration tests;
4. run production build where relevant;
5. fix failures before continuing;
6. summarize:
   - what changed;
   - important files;
   - tests/build result;
   - remaining risks;
   - next recommended phase.

Do not claim something works without running the available verification commands.

## 13. Do not overengineer MVP infrastructure

The first deployed MVP may use:

- one backend instance;
- in-memory active room state;
- PostgreSQL for durable data.

Do not add Redis/Kubernetes/microservices merely because they might be useful someday.

Design boundaries so Redis/horizontal scaling can be introduced later.

## 14. Product constraints

Do not add without explicit request:

- payments;
- betting/gambling;
- public matchmaking;
- accounts;
- rankings;
- leaderboards;
- tournaments;
- production/public AI opponents;
- spectators;
- native apps;
- voice in the initial implementation.

## 15. Quality bar

Code should be understandable and maintainable by a senior engineer.

Prefer:

- explicit domain types;
- small focused modules;
- typed errors;
- deterministic tests;
- meaningful naming;
- minimal magic;
- comments only where they explain non-obvious domain reasoning.

Avoid:

- hidden side effects;
- duplicated scoring rules;
- giant React components;
- direct fetch/socket calls scattered across UI;
- "temporary" hacks that become architecture.

## 16. Critical rule warning

This project uses a specific Azerbaijani-family ruleset.

Important non-generic behaviors include:

- first-match double priority;
- score must be opened by a single 13+ round;
- sub-13 wins before opening become team-specific pending opening points;
- those pending points can accumulate across that team's consecutive wins;
- pending alone never opens the score;
- opponent winning before opening burns those pending points;
- a later qualifying 13+ win opens the score and includes that team's accumulated pending points;
- after opening, sub-13 wins score normally;
- special `0:0` behavior;
- bağlanma scoring;
- equal bağlanma = SEKA;
- shared accumulating SEKA Bank;
- next non-SEKA winner claims the SEKA Bank;
- winning team chooses which partner starts the next round;
- match victory at score >= 101.

Do not replace any of these with a ruleset found online.

## 17. First action

Start by:

1. reading the three specification files;
2. inspecting the repository;
3. reporting the current repository state;
4. proposing only the first implementation phase;
5. then implement Phase 1 unless the repository already satisfies it.

Do not jump directly to a finished full-stack application.
