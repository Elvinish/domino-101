# Phase 4 — playable React multiplayer UI

## Scope

The existing four-player room server is now playable from the browser. Game rules,
engine, bot strategies, shared multiplayer protocol and server authorization/private
projections are unchanged. No reconnect or persistence architecture was introduced.

## Frontend structure

- `apps/web/src/multiplayer/client.ts`: transport lifecycle, typed Socket.IO requests,
  runtime snapshot validation, authoritative revisions, bounded pending request,
  subscriptions and private-data cleanup. No React or game-rule implementation.
- `apps/web/src/multiplayer/errors.ts`: exhaustive, useful messages for all protocol
  error codes. Raw exception details and network payloads are never logged.
- `apps/web/src/app/App.tsx`: routes, client subscription via `useSyncExternalStore`,
  connection/error presentation and explicit leave flow.
- `components/Entry.tsx`: display name, create/join and invitation entry.
- `components/Room.tsx`: sharing, lobby readiness and lobby/game switching.
- `components/Seats.tsx`: relative seat layout, partnerships, host and connection state.
- `components/GameTable.tsx`: public table, own hand, server-provided legal actions,
  scores, starter selection and results. Local state is only an end-selection choice.
- `components/Domino.tsx`: pip rendering, without game legality or score calculation.
- `styles.css`: responsive felt table, ivory tiles, restrained Bakı identity and focus states.

## Routes and entry

`/` offers a display name, private-room creation and code-based joining.
`/room/:roomId` accepts a share link; only a display name is required. Invalid links
are rejected locally, while nonexistent/full/started rooms show server errors.
Creating a room navigates to its shareable route after server acceptance.
A user with an existing seat is directed back to that table rather than silently
joining another. Unknown routes provide a home link.

Room code and invite link have explicit copy buttons. Clipboard denial displays a
manual-copy fallback; the code remains selectable. Names are rendered as React text.
No accounts, browser storage of identity/hands, or credentials are used.

## Socket and state flow

The configured `VITE_API_BASE_URL` connects to the existing server. A fresh client
uses WebSocket first with polling fallback; automatic reconnect and retry are off.
Subscriptions are installed before connection and removed on disposal. React Strict
Mode mount/cleanup cycles dispose the old connection before creating a new one.

Strict protocol schemas validate all consumed snapshots and acknowledgements.
A room snapshot must belong to the assigned room; a game snapshot must also match
the assigned player and seat. Older/equal snapshots are ignored. A game snapshot
behind the current room revision is ignored. Actions stay disabled while room/game
revisions differ, while disconnected/paused, or while a request is pending.

Gameplay sends a fresh UUID `commandId` and the current authoritative
`expectedRevision`. One request can be pending at a time. There is no optimistic
hand, board, turn or score mutation. Acknowledgements never replace snapshots or
roll their revision backward. `STALE_REVISION` explains the changed table and asks
the player to choose again against the received snapshot; it never forces/retries
the old command. Socket.IO preserves event order on the live connection.

A ten-second acknowledgement timeout has an unknown outcome. The client disconnects
and clears its private game snapshot rather than pretending the seat can resume.
Disconnect clears the pending request and hand; late callbacks cannot restore it.
The room summary remains to explain what happened. Leave clears all state and opens
a fresh connection for a new room. Active rooms pause when another player leaves.

## Gameplay

The local seat is at the bottom, partner opposite and opponents to either side.
Names, team, host, connection state and opponent hand counts are public. Turn text
and an outline accompany the color indicator.

The board uses server-supplied tile orientation in an ordered left-to-right chain.
Doubles are upright. Its horizontal scroll area contains long chains without page
overflow; the open-end values remain visible above it. It is keyboard focusable and
works with touch scrolling. Canonical tile identities are stable React keys.

Only the local private hand is rendered. Server `legalActions` determine which tiles
and controls are enabled. A single placement submits directly; two placements show
explicit left/right buttons and Cancel. No hover interaction is required. A choice
expires when its snapshot revision changes. Pass exists only when the server allows
it. Starter selection lists both eligible partners; the server locks the first
accepted choice. Host-only next-round actions come from the same legal-action list.

The score panel displays official totals, opened/unopened state, pending opening
points, round and SEKA bank when nonzero. A short explanation distinguishes pending
points from official scores. Round results display normal/bağlanma/SEKA outcomes,
public remaining-point totals and the authoritative award. Match victory ends play;
a new match requires a new room.

## Responsive and accessibility baseline

Desktop uses a wide table; tablet compresses side seats. Phone retains opposite
partners, fits the table into the page and wraps the seven-tile hand as needed.
Tile targets are at least 44 CSS pixels wide; buttons have a 44-pixel minimum height.
The board alone scrolls horizontally. Important controls are ordinary buttons and
labeled inputs, usable by keyboard and touch. Focus is visible, tiles have pip-value
accessible names, updates use status/alert text, and critical states include words.
Reduced-motion preference removes transitions. Deeper accessibility work is Phase 7.

## Tests and privacy audit

Vitest/React Testing Library covers entry routes, create/join, missing/invalid rooms,
four-seat layout and host readiness, sharing failures, own-hand rendering, oriented
board/doubles, legal and ambiguous placements, pending controls, pass, starter
selection, scoring/pending/opened state, SEKA, round and match results.

Client tests cover validation, UUID/revision envelopes, duplicate submission
prevention, stale responses/snapshots, foreign private projections, malformed data,
disconnect/timeout cleanup, paused/mismatched snapshots and listener disposal.

`e2e/multiplayer.spec.ts` uses four isolated Chromium browser contexts against the
actual production-built web app and actual Fastify/Socket.IO server. No socket mock,
client test hook, hidden engine state or direct engine transition drives gameplay.
Desktop plays a complete match through UI controls. Tablet and phone create/join,
start, play real moves, check touch targets/page overflow and observe an actual
browser disconnect. Received WebSocket events are validated against strict schemas;
every game revision is audited against the other browsers' then-private hands.
Browser hand rendering is compared with its own private projection.

Run:

```sh
pnpm install --frozen-lockfile
pnpm exec playwright install chromium
pnpm verify
pnpm test:socket
pnpm test:e2e
```

The E2E runner owns ports 3101 and 4173, refuses to reuse existing servers, and builds
the web app with its isolated server URL. Screenshots are local QA artifacts under
ignored `test-results/`; no traces or packet logs are saved. Do not publish browser
artifacts containing private hands. A normal `pnpm build` restores the normal web
configuration after the E2E build.

Verification used Node.js 24.21.0, pnpm 10.34.5, Vitest 4.1.11 and Playwright
1.63.0 with Chromium 153.

| Check                                | Result                                                                        |
| ------------------------------------ | ----------------------------------------------------------------------------- |
| Frozen-lockfile offline installation | Passed; lockfile current                                                      |
| Prettier                             | Passed across repository                                                      |
| ESLint                               | Passed, zero warnings allowed                                                 |
| Full typecheck                       | Passed, including browser tests and Playwright configuration                  |
| Full Vitest                          | **317 passed in 21 files**, zero failures (53.99 seconds)                     |
| Frontend portion of full Vitest      | **43 passed in 4 files**: 35 UI/client tests and 8 existing environment tests |
| Dedicated Socket.IO integration      | **25 passed in 2 files**, zero failures (687 milliseconds)                    |
| Production build                     | Passed for all shared packages, server and web                                |

Final Playwright rerun: **3 passed, zero failures/skips**, 40.1 seconds total:

- Desktop, 1440 × 1000: **1 passed** (27.0 seconds), complete match through UI.
- Tablet, 820 × 1180: **1 passed** (4.4 seconds), real gameplay and disconnect.
- Phone, Pixel 7 viewport with touch: **1 passed** (5.4 seconds), real gameplay and disconnect.

All browser privacy audits, synchronized revisions, own-hand rendering and page
overflow checks passed. Desktop and phone screenshots were visually reviewed.
The normal production web build was restored and passed after E2E. Real socket
listening and Chromium execution used the required sandbox permissions; no tests
were skipped or replaced by mocks. The runner printed only a non-failing terminal
color-environment warning (`NO_COLOR` versus `FORCE_COLOR`).

An initial E2E typecheck found an optional viewport passed where a concrete value
was required; the configuration now supplies an explicit fallback. Final full
checks above include that correction. No server or engine changes were needed.

## Limitations and next phase

Connection loss or page refresh cannot restore an active seat. Keep the tab open;
a fresh room is required after active-match disconnection. Lobby seats are released
on disconnect. This is the documented Phase 3 limitation, visibly surfaced here.
State remains in one server process and is lost after everyone leaves or restart.

No PostgreSQL/Drizzle, tokens, accounts, text chat, reactions, voice, matchmaking,
Redis, deployment infrastructure or Phase 5 work was added. Browser emulation does
not replace physical-device testing or Safari/Firefox verification. Remote networks,
production HTTPS/WSS and hosting are not verified. The app is ready for the next
phase once the checks below pass, not production deployment.

Stop after Phase 4. Phase 5 requires explicit instruction.
