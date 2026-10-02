# Phase 2A — deterministic bots and simulations

## Scope

Implemented the QA bot/simulation layer in `packages/bot-player`. The Phase 2
engine API, rules and existing engine tests are unchanged. No engine correctness
bugs have been discovered by the seed sweep or negative command probes.

No room server, gameplay UI, networking, persistence, reconnect, chat or voice was
added. The existing protocol dependency is untouched; this phase uses only the
engine's public package API and local modules. ESLint prevents new external
imports in bot production code and prohibits `Math.random`. The package has no
Node or browser types; the separate command-line wrapper uses Node only for
arguments, output, exit status and elapsed time.

## Structure and public API

| File                  | Responsibility                                                                   |
| --------------------- | -------------------------------------------------------------------------------- |
| `rng.ts`              | Explicit Mulberry32 state, seed validation and Fisher–Yates deck permutation     |
| `types.ts`            | Bot commands/views, simulation options, results, summaries and coverage counters |
| `actions.ts`          | Private-hand-safe QA view, engine legal-action adaptation and command dispatch   |
| `strategy.ts`         | Deterministic-first and seeded-random choices from supplied actions              |
| `simulation.ts`       | Full-match orchestration, independent streams, limits and replay recording       |
| `invariants.ts`       | Independent transition checks and real-engine illegal-command probes             |
| `diagnostics.ts`      | Bounded public summaries, replay fingerprint and structured failures             |
| `coverage.ts`         | Observational scenario counters, never authoritative scoring                     |
| `immutable.ts`        | Freezing newly owned output values                                               |
| `index.ts`            | Public exports                                                                   |
| `__tests__/`          | RNG, strategy/privacy, invariant, limit/replay and seed-batch tests              |
| `scripts/simulate.ts` | Typed Node command-line wrapper; outside the platform-independent package        |

Use the exports of `@domino/bot-player`:

- `nextRandom(state)` returns the next explicit state and a number in `[0,1)`.
- `shuffleDeck(state)` returns a shuffled full canonical deck and next RNG state.
- `getBotView(state, seat)` copies public board/score/counts, that seat's own hand,
  and legal actions. No opponent or partner tile values or internal state object
  are passed to strategies. Waiting seats and terminal phases have no actions.
- `chooseCommand(view, strategy, rngState)` returns a command (or `null`) and next
  RNG state. It does not access engine state or implement any game rules.
- `applyBotCommand(state, command)` delegates to `playTile`, `passTurn` or
  `selectStarter`; bots never mutate state or submit authoritative scores.
- `simulateMatch(options)` drives an entire match and returns immutable results.
- `assertSimulationState`, `assertSimulationTransition`, and
  `assertIllegalCommandsRejected` expose QA assertions without engine internals.
- `SimulationFailure` carries a structured `.diagnostic` for replay.

The QA view is a local adapter, not the future network projection/DTO architecture.
Only the runner, adapter and invariant checker receive internal engine snapshots.

## Strategies and determinism

`deterministic-first` selects the first legal action after stable sorting by
canonical tile identity and `start`, `left`, `right`; starter choices sort by seat.
It consumes no decision RNG. `seeded-random` selects uniformly by index using the
next seeded draw, including when exactly one action is available. Waiting seats
consume no draw. Strategies can be supplied as one name for all players or a
four-element tuple indexed by seat.

The seed is an unsigned 32-bit integer, including zero and `4294967295`.
`domino-simulation-v1` fixes Mulberry32, seed mixing, shuffle order, stream use,
action ordering and scheduling. Decks and each of the four bot seats have separate
streams, so decision draws do not perturb subsequent deck permutations. These
streams are reproducible QA data, not cryptographic randomness for production.

Replay requires the same engine/package version, seed, strategy configuration,
limits and optional initial engine snapshot. `recordTrace: true` records all
commands with concise before/after summaries, bounded by the configured command
limit. Default results omit the full trace. The transcript hash is a compact,
non-cryptographic fingerprint; tests compare complete recorded results and
commands directly rather than relying on a hash collision assumption.

An optional `initialState` must be an engine-produced snapshot. The simulator does
not parse untrusted JSON or reconstruct state from diagnostic summaries. Supplied
initial state is not mutated. Its original snapshot must be retained separately
to replay a failure; diagnostics label this origin as `provided`.

## Simulation flow and limits

1. Validate options and create a seeded full deck, or use the supplied snapshot.
2. Create a match through `createMatch` and check invariants.
3. During play, build only the current seat's view and choose a normal command.
4. During starter selection, the lower-numbered eligible partner acts first and
   its strategy chooses either eligible partner. This is deterministic scheduling,
   not a simulation of network races.
5. After a completed round, shuffle the next deck and call `startNextRound`.
   The engine decides between partner selection and retaining the SEKA starter.
6. Check negative command rejection and transition invariants throughout.
7. Stop immediately at `match-finished`, verify invalid commands remain rejected,
   and return a summary without internal hands or full mutable state.

Defaults: 10,000 commands and absolute round number 500. Plays, passes, selections
and next-round commands each count once; initial creation does not count. Negative
probes do not count as applied commands or consume RNG. Reaching the limit exactly
on successful completion is allowed. Exceeding it produces `COMMAND_LIMIT` or
`ROUND_LIMIT` before another transition.

Results include seed/configuration, winner, official final scores, complete final
pending/opened score counters, command count, absolute final round number,
completed-round count within this invocation, SEKA count, coverage counters,
round summaries and transcript fingerprint. Successful results have
`safetyLimitHit: false`; failures carry the corresponding flag in diagnostics.

Failure diagnostics include version, seed, strategies, limits, origin, attempted
one-based command index, phase, round, actor, attempted command, concise public
state and at most eight recent transitions. Next-round commands do not include
the deck. No hidden hands, huge engine snapshots, reconnect tokens, or raw thrown
error objects are dumped. A configured full success trace is opt-in.

## Invariant checks

- All 28 canonical unique tiles accounted for across exactly four hands and board.
- Each tile has one location; no duplicate or missing tiles.
- Seats/turns and opposite-team mapping remain valid.
- Official scores, pending points and SEKA bank stay nonnegative safe integers;
  official scores never decrease.
- Engine snapshot invariants and board connectivity still hold.
- Accepted plays belong to the real engine legal-action set, use an explicit end,
  grow the board once, and remove only the acting player's tile.
- Accepted passes have zero legal moves, preserve hands/board/score, and advance turn.
- The real engine rejects illegal passes when moves exist, illegal/unowned tile
  attempts, and `start` placement on a nonempty board.
- Scores do not change mid-round or on deal/selection; SEKA accounting, bank claims
  and loser pending-point burning remain consistent.
- Non-SEKA starter rights belong to the winning team. Selection stays within that
  team and locks the starter. SEKA retains the exact prior starter.
- Victory has an official score at least 101; simulation stops immediately and
  further play/pass/selection is rejected by the engine.

Checks observe/reject failures; they never repair state or compute an alternative
result for the engine. Fault injection is confined to invariant-checker unit tests.
Rule scenario tests use real fresh matches and normal engine transitions.

## Running and replaying

```sh
pnpm simulate --seed 0 --count 1000 --strategy seeded-random
pnpm simulate --seed 386 --count 1 --strategy seeded-random
pnpm simulate --seed 0 --count 32 --strategy deterministic-first
pnpm simulate --seed 0 --count 1 --max-commands 1
```

The root command builds workspace packages first, then runs the typed CLI with
Node 24. The last example intentionally exits nonzero with bounded diagnostics.
The CLI prints aggregate results, not per-match hidden information, and reports
elapsed time outside deterministic simulation results. Replay one failure with
its seed, strategy and original limits. Mixed seat strategies and supplied initial
states use the library API rather than CLI flags.

## Seed coverage and verification

The automated large batch runs all **1,000 seeds from 0 through 999** with four
seeded-random bots. Two additional batches run seeds 0–31 with deterministic-first
and mixed strategies: **1,064 complete matches in the batch tests**. Unit/replay
and targeted tests run further matches, including the maximum uint32 seed.

Naturally reached regression seeds:

| Seed | Scenario                                                                                    |
| ---- | ------------------------------------------------------------------------------------------- |
| 0    | Ambiguous ends, score opening, overshoot above 101, later starters with no/multiple doubles |
| 4    | Pending points burned by an opponent win                                                    |
| 8    | SEKA and subsequent bank claim                                                              |
| 11   | Pending accumulation exceeds 13 while score remains unopened                                |
| 384  | 14-round match                                                                              |
| 386  | Consecutive SEKA with preserved starter rights                                              |

Initial 1,000-seed sweep: **1,000 completed**, **0 failures**, **6,970 rounds**,
**190,202 commands**, **112 SEKA rounds**, **2 consecutive-SEKA occurrences**,
**27 pending accumulations**, **130 pending burns**, **31,472 ambiguous placements**,
**567 later starters without doubles**, **3,525 with multiple doubles**. The longest
match was 14 rounds. The sweep took approximately **43 seconds** on this machine.
All these observations came from public engine transitions; no engine rule changes
or fabricated rare-scenario states were needed.

Verified with Node **24.21.0**, pnpm **10.34.5**, and Vitest **4.1.11**.

| Check                          | Result                                                                    |
| ------------------------------ | ------------------------------------------------------------------------- |
| Prettier write/check           | PASS — all matched files                                                  |
| ESLint                         | PASS — zero errors/warnings                                               |
| Full TypeScript typecheck      | PASS — all workspace packages/apps plus root tooling and typed CLI        |
| Full Vitest                    | **229 tests passed in 14 files**, zero failures/skips                     |
| Bot/simulation tests           | **69 passed in 5 files**                                                  |
| Existing engine tests          | **130 passed in 4 files**, unchanged                                      |
| Existing foundation tests      | **30 passed in 5 files**                                                  |
| Production build               | PASS — three shared packages, server and web; no warnings                 |
| CLI success smoke              | PASS — seed 386 completes, including two consecutive SEKA rounds          |
| CLI limit smoke                | PASS — intentional limit exits 1 with structured seed/command diagnostics |
| Bot dependency/RNG lint probes | PASS — engine import allowed; Node/React and `Math.random` rejected       |

The simulation-heavy full Vitest run took **54.70 seconds** wall time on this
machine. The separate 1,000-match sweep took about 43 seconds. No dependency
installation, network access or changes to game-engine source/tests were needed.
After recording results, documentation formatting was applied and rechecked.

## Limitations and next phase

Finite seed coverage is not a proof over every possible game. The strategies are
QA tools, not competitive or production AI. They intentionally use simple choices.
No cryptographic shuffle, real concurrent commands, network authorization,
client projections, browser UI, database or deployment behavior was verified here.
The existing 130 Phase 2 engine tests remain unchanged and included in verification.

Ready for Phase 3 only after explicit instruction. Stop after Phase 2A.
