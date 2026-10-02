# Phase 2 — pure Domino-101 game engine

## Scope and structure

Authoritative rules remain [GAME_RULES.md](GAME_RULES.md), reached through the root
rules pointer. Phase 1 applications and infrastructure remain intact. All new
authoritative domain code is in `packages/game-engine/src`:

| File            | Responsibility                                                                                     |
| --------------- | -------------------------------------------------------------------------------------------------- |
| `types.ts`      | Canonical tiles, four seats/hands, teams, board, results, score and phase unions                   |
| `tiles.ts`      | Tile construction, ordered double-six deck, validated round-robin dealing, teams and first starter |
| `board.ts`      | Oriented placements, derived open ends, legal moves and explicit end selection                     |
| `scoring.ts`    | Per-hand points, blocked results, pending/opened scores, SEKA and match threshold                  |
| `match.ts`      | Pure match transitions, round completion and starter selection                                     |
| `invariants.ts` | Snapshot checks: tile conservation, board connectivity, counters, results and phase consistency    |
| `errors.ts`     | Typed `EngineError` codes and freezing of engine-owned outputs                                     |
| `index.ts`      | Public package exports                                                                             |
| `__tests__/`    | Deterministic rule tests and fixed complete-round command fixtures                                 |

No runtime dependencies were added. The package uses no React, transport, database,
Node I/O, browser API, clock, random source or mutable global game state. Test
fixtures are excluded from production compilation. The existing ESLint import
pattern had an escaping bug that would reject relative imports once the empty
engine gained code; it was corrected and explicitly checked to reject `node:fs`
while allowing local imports.

## Domain decisions

- Tiles are canonical string literal identities, `0:0` through `6:6`, with the
  smaller pip first. `createTile(6, 1)` returns `1:6`. Board orientation is stored
  separately as `left`/`right` pips, so flipping a tile never changes ownership.
- Seats are `0 | 1 | 2 | 3`; Team A is seats 0/2, Team B is 1/3. Turns advance
  clockwise `0 → 1 → 2 → 3 → 0`.
- The caller supplies a complete ordered deck. Dealing is round-robin: positions
  0,4,8,… go to seat 0. Each seat receives seven unique tiles, with no boneyard.
  No shuffle or hidden randomness exists in this phase. A future server must
  supply a securely shuffled order; deterministic tests supply fixed orders.
- Snapshot types are readonly and engine-returned match snapshots are deeply
  frozen. Transitions copy data and never mutate or freeze caller-owned inputs.
  Identical inputs produce identical outputs; rejected commands leave inputs intact.
- Open ends are derived from the oriented board, avoiding a second mutable copy.
  Missing end selection is accepted only for a single legal placement. Two legal
  ends require an explicit choice, even if both ends have the same pip. The empty
  board uses `start`, or an omitted end; `left`/`right` are invalid until it opens.
- Every match transition validates the current snapshot and its output. All 28
  unique canonical tiles must exist exactly once across hands and board.
- Errors throw `EngineError` with stable codes and no hand contents. A future
  application layer may map these codes to its own protocol and localized messages.

## State machine

```text
createMatch(deck)
    → playing (first round, required opening double)

playing -- playTile / passTurn --> playing
playing -- hand emptied / nobody can play --> round-ended
playing -- round score takes a team to >=101 --> match-finished

round-ended -- startNextRound(deck), non-SEKA --> starter-selection
starter-selection -- selectStarter(actor, selected) --> playing
round-ended -- startNextRound(deck), SEKA --> playing (same starter)
```

`round-ended` preserves final hands, board, result, and already-applied scores for
later presentation. It cannot accept additional plays or passes. `startNextRound`
is legal only there and deals the next round before selection. Only winning-team
partners may select, and only a partner of that team may be selected. Omitting the
selected seat means the actor selects themselves. A successful selection moves to
`playing`, so another selection against the updated state fails. The future room
server must serialize commands and retain the returned current state; a pure
engine intentionally does not track which historical snapshots a caller retains.

`match-finished` accepts no further game commands or next rounds. Rematches,
player identities, revision IDs and persistence are later application concerns.

## Public API

Import from `@domino/game-engine`; workspace consumers use compiled ESM exports.

| API                                                                   | Contract                                                                                  |
| --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `createTile`, `isTile`, `tilePips`, `isDouble`                        | Canonical tile helpers and pip validation                                                 |
| `createDeck`, `dealTiles`                                             | Ordered 28-tile set; validate and distribute a supplied complete permutation              |
| `SEATS`, `teamOf`, `otherTeam`, `nextSeat`                            | Four-seat/team mapping and deterministic turn order                                       |
| `OPENING_DOUBLE_PRIORITY`, `findFirstStarter`                         | Required first double and its holder                                                      |
| `getOpenEnds`, `getLegalPlacements`, `legalMovesForHand`, `placeTile` | Board-level primitives; these do not authorize a match command                            |
| `createScoreState`, `scoreHand`, `remainingTeamPoints`                | Initial counters and per-player/team remaining points                                     |
| `isBlocked`, `resolveBlockedRound`                                    | No legal move anywhere; lower-total winner or equal-total SEKA                            |
| `applyRoundResult`, `getMatchWinner`                                  | Pure scoring primitive and official-score threshold                                       |
| `createMatch(deck)`                                                   | Validate a full deal and enter first-round play                                           |
| `getLegalMoves(state, seat)`                                          | Current player's legal commands, including opening restrictions; rejects wrong phase/turn |
| `playTile(state, seat, tile, end?)`                                   | Validate ownership, opening and placement; advance turn or settle the round/match         |
| `passTurn(state, seat)`                                               | Advance only when current player has no legal move                                        |
| `startNextRound(state, deck)`                                         | Deal the next round; select winning partner or retain SEKA starter                        |
| `selectStarter(state, actor, selected?)`                              | Validate both seats, lock starter by entering play                                        |
| `assertMatchState(state)`                                             | Validate typed domain snapshot invariants                                                 |

Callers should use match transitions for authoritative play, not bypass them by
assembling board/scoring primitives. `applyRoundResult` is available for focused
rule testing; match transitions derive results internally and apply them once.
`findFirstStarter` also accepts valid partial hands for priority fallback tests;
real match creation always requires the entire set, so `1:1` is always present.

Engine state contains **all four hidden hands**. It is internal authority state,
never a client DTO. Do not send it to clients or logs. Per-player projections,
identity authorization and Zod transport parsing remain future phases.
`assertMatchState` validates typed snapshots, not arbitrary untrusted JSON, socket
ownership or full historical provenance. Clients must never submit engine state
or authoritative round results.

## Rule edge cases

- First opening priority is `1:1 → 2:2 → 3:3 → 4:4 → 5:5 → 6:6 → 0:0`.
  The first starter must use the qualifying double, even if holding other doubles.
- Later starters must play any held double; only a hand with no doubles may open
  any tile. This restriction ends after the opening tile.
- A hand-emptying play ends the round immediately; it takes precedence over
  blocked scoring. Partner leftovers are not added to the losing-team award.
- `0:0` scores ten only as that individual player's sole remaining tile. Partner
  tiles do not change that condition. With any tile in the same hand it scores zero.
- A blocked result requires no legal move in any hand, not merely an unplayable
  current hand. Detection follows each play immediately, without four dummy passes.
  An empty board or already emptied hand is not a blocked-round result.
- A blocked winner receives the losing total, not the difference or combined total.
- `7+8+12` remains 27 pending and zero official. A single qualifying win of 15 opens
  at 42. Opponent wins burn unopened pending points, never transfer them. Opened
  scores remain opened and accept sub-13 wins.
- Equal blocked totals create no winner. Both totals accumulate in `sekaBank`;
  SEKA neither opens scores nor burns pending points. A non-SEKA winner receives
  the entire bank once; the resulting **effective round value** is tested against
  13, as the authoritative rules specify. The bank then resets, even if that small
  effective value remains pending.
- SEKA keeps the exact previous starter, including first-round SEKA and SEKA after
  partner selection. The next round uses later-round opening rules, not the first
  round's mandatory `1:1`.
- Victory tests official score `>=101`, including a claimed bank and pending points
  credited on opening. Pending points alone never trigger victory.

## Verification and coverage

Verified with Node **24.21.0**, pnpm **10.34.5**, and Vitest **4.1.11**.
The complete `pnpm verify` command exited successfully after the final source/test
changes, including both additional starter-rights regressions.

| Check                                 | Final result                                                  |
| ------------------------------------- | ------------------------------------------------------------- |
| `pnpm format` and `pnpm format:check` | PASS — all matched files formatted                            |
| `pnpm lint`                           | PASS — zero errors and zero warnings                          |
| `pnpm typecheck`                      | PASS — all 5 workspace packages/apps and root test config     |
| `pnpm test`                           | PASS — **160 tests in 9 files**, zero failures/skips          |
| Engine portion                        | **130 tests in 4 files**                                      |
| Existing foundation portion           | **30 tests in 5 files**                                       |
| `pnpm build`                          | PASS — 3 shared packages and both applications; no warnings   |
| Engine ESLint import boundary probe   | PASS — external Node import rejected; relative import allowed |

No dependencies, lockfile changes, or network access were needed for Phase 2.
The only shared tooling correction was the existing relative-import regex.
After recording these results, the documentation formatting check was rerun.

Coverage includes complete fixed normal, bağlanma and SEKA command sequences,
per-command conservation/immutability checks, both teams' starter rights,
consecutive SEKA followed by a match-winning bank payout, invalid commands/states,
canonical/dealing checks, all important `0:0` combinations, pending/opening rules,
and exact/overshooting match thresholds. These are deterministic fixtures, not a
bot package or simulation runner. No coverage percentage is claimed.

## Deferred / unverified

No Phase 2A bots, simulation runner or large-seed simulation was implemented.
No server room orchestration, network protocol, UI gameplay, secure shuffle,
reconnect, chat, voice, database or persistence was implemented. Real-browser,
multiplayer and deployment behavior was not newly verified in this engine phase.
The full existing Phase 1 tests remain part of verification.

Ready for Phase 2A after explicit instruction. This remains an engine foundation,
not a deployed or playable multiplayer application. Stop after Phase 2.
