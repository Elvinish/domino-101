# Phase 9 — room voice and final verification

Phase 9 adds optional audio-only voice to the existing four-player private rooms.
Game rules, scoring, revisions, private projections, persistence schema, chat and
reconnect credential architecture are unchanged. No hosting, domain or TURN service
was provisioned. There are no new runtime dependencies.

## Implementation boundaries

- `packages/protocol/src/voice.ts`: strict Zod request/response schemas and typed
  Socket.IO events, exported through the existing protocol package.
- `apps/server/src/voice/service.ts` and `socket.ts`: ephemeral membership,
  negotiation bookkeeping, authorization and targeted forwarding.
- `apps/web/src/voice/client.ts`: explicit microphone acquisition, signaling,
  participant state and ownership of streams and peer lifetimes; no React.
- `apps/web/src/voice/peer.ts`: one audio transceiver per connection, serialized
  negotiation, bounded ICE queues, remote streams and failure handling; no React.
- `apps/web/src/components/VoicePanel.tsx`: presentation and one logical audio output
  per peer, including blocked-autoplay recovery. EN/RU/AZ messages use existing i18n.
- Small integration hooks in the existing multiplayer client and server bind and
  reset voice on room join, disconnect, replacement, leave and room expiry.

The server has no media API, audio processing, recording or relay. Audio uses native
browser WebRTC; Socket.IO carries only control/signaling. Four active participants
have a maximum of three peer connections each, six pairs in total. The lower seat
initiates the offer; the higher seat answers. Duplicate offers/answers are rejected.
Mute changes the existing audio track's `enabled` state and never renegotiates.
There is no speaking detection or audio-level reporting.

## Signaling and isolation

| Direction            | Events                                                                                          | Data and purpose                                                                             |
| -------------------- | ----------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Client → server      | `voice:join`, `voice:leave`                                                                     | Room and UUID attempt ID; allows cancellation even while the join acknowledgement is pending |
| Client → server      | `voice:ready`, `voice:state`                                                                    | Room, server-issued voice session ID and muted state                                         |
| Client → server      | `voice:offer`, `voice:answer`                                                                   | Room, own voice ID, target player/voice IDs, one-audio SDP                                   |
| Client → server      | `voice:ice`                                                                                     | Same targeting fields and a bounded candidate or end-of-candidates marker                    |
| Server → room        | `voice:participants`, `voice:peer-joined`, `voice:peer-ready`, `voice:state`, `voice:peer-left` | Public identities, readiness, muted state and voice IDs; at most four participants           |
| Server → target only | `voice:offer`, `voice:answer`, `voice:ice`                                                      | Socket-derived sender ID and voice ID, target voice ID and signal                            |
| Server → requester   | acknowledgement; `server:error` on failure                                                      | Strict success or safe existing error code, never raw errors                                 |

Every request rechecks live socket ownership and same-room membership inside the
existing room queue, including after pending database work. Target ownership and
voice session are checked again before forwarding. Sender identity, seat and name
are never accepted from the client. Replaced/disconnected sockets, cross-room
signals, nonexistent/self targets, invalid epochs and unready peers are rejected.

Attempt IDs are cancellation correlation, not credentials. A fresh server-issued
voice ID fences signals from older joins, even when the same player re-enables
voice on the same socket. A late leave cannot cancel a newer attempt. Old socket
disconnects cannot remove a replacement's voice membership.

Schemas reject unknown keys, video/data SDP, oversized SDP (6,000 characters) and
oversized ICE (2,048 candidate characters). There is one audio m-line. Browsers
validate SDP semantics. The existing 8 KiB transport limit remains. Signaling is
limited to 240 requests per socket per ten seconds; validated leave is still
allowed for cleanup. ICE queues are bounded to 64 entries per direction per peer.
Game and chat retain their existing independent limits.

## Microphone, lifecycle and failure handling

The microphone is off on page load, room entry, refresh and reconnect. Receiving
participant updates does not request media or create a connection. Only the enable
or explicit retry control invokes `getUserMedia`, with audio and no video. Acquired
tracks stay disabled until join/ready succeeds. Permission denial, missing devices,
missing APIs and ended tracks produce localized safe messages, without raw browser
exception text. A permission result arriving after cancellation is immediately stopped.

Mute/unmute reuses the stream. Leave, UI teardown, `pagehide`, transport disconnect,
room replacement and client disposal stop local tracks, close peer connections,
clear timers and pending signaling, stop remote tracks, and detach audio elements.
Reconnecting the table never resumes the microphone automatically. A remote peer's
new voice ID replaces the old connection; repeated snapshots create no duplicates.
Voice activity and signaling are not written to PostgreSQL and do not increment
room/game revisions.

ICE received before a remote description is queued. Local candidates wait until
its description has been acknowledged. All asynchronous continuations check their
lifetime before changing state or sending messages. A connection has a 20-second
initial timeout and a 10-second disconnected grace period. Failure closes only the
affected peer and exposes a manual reconnect-voice control; no infinite retry loop.
The microphone may stay enabled for other peers until the user leaves or retries.

Remote tracks use one hidden audio element per peer, `srcObject`, inline playback
and explicit `play()`. Blocked autoplay exposes a named play button. Remote output
is removed on peer leave. The compact panel is in normal document flow, wraps on
phone widths and uses existing touch sizing, focus and safe-area styles. Text
states distinguish off/not joined, joining, mic enabled, muted, connecting,
connected, disconnected and unavailable. Mic state is self-reported, not proof of
physical audio. Live announcements cover meaningful local changes, not ICE events.

## Configuration and production

`VITE_WEBRTC_ICE_SERVERS` is a JSON array of at most eight ICE configurations, each
with a URL or up to four URLs and optional username/credential. STUN/STUNS and
TURN/TURNS are validated; TURN needs both credential fields. Invalid configuration
fails with the variable name only, never the value. Vite embeds this configuration
at build time; rebuild to change it.

```dotenv
# Default when omitted:
VITE_WEBRTC_ICE_SERVERS=[{"urls":["stun:stun.l.google.com:19302"]}]
# Example only; no relay was provisioned:
# VITE_WEBRTC_ICE_SERVERS=[{"urls":"stun:stun.l.google.com:19302"},{"urls":"turn:turn.example.com:3478?transport=udp","username":"scoped-user","credential":"short-lived-credential"}]
```

Use `[]` for local host-candidate-only checks. There are no hardcoded production TURN
credentials. Browser TURN credentials necessarily reach clients: prefer limited,
short-lived credentials. A dynamic issuer/refresh endpoint is outside this phase;
the current build-time configuration alone does not implement credential rotation.
Without a reachable TURN service, some NAT/firewall combinations cannot establish
audio. Public STUN is a third-party dependency; connections contact it only after
explicit opt-in and when a remote peer is ready. Peers can learn network addresses
through normal P2P setup.

Deploy with HTTPS/WSS, the exact `WEB_ORIGIN`, the public API origin, suitable ICE
servers, one application instance, and PostgreSQL configured as documented in
Phase 8. Ship compiled server files and checked-in migrations. Configure database
access controls/TLS, backups, restore procedures and monitoring. Do not log raw
Socket.IO frames, SDP, ICE, reconnect tokens, private hands or environment secrets
in application or proxy diagnostics. This implementation does not add any such logs.

## Verification

Final verification on 2026-10-03 used Node 24, pnpm 10.34.5, Vitest 4.1.11,
Playwright 1.63.0 / Chromium 153.0.8010.12, and real local PostgreSQL 18.6.
All listed final checks passed; no tests were skipped in the full suite.

| Check                                                                        | Exact final result                                                                                                                                                                     |
| ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm install --frozen-lockfile --store-dir /Users/Elvin/Library/pnpm/store` | Pass; lockfile unchanged, all six workspace projects already up to date                                                                                                                |
| `pnpm format`, `pnpm format:check`                                           | Pass; all matched files use Prettier formatting                                                                                                                                        |
| `pnpm lint`                                                                  | Pass; zero warnings/errors                                                                                                                                                             |
| `pnpm typecheck`                                                             | Pass; packages, apps, tests, tooling and E2E TypeScript                                                                                                                                |
| Full Vitest with `TEST_DATABASE_URL` supplied                                | **496 passed, 40 files passed**, 0 failures/skips; final run 58.87 s                                                                                                                   |
| `pnpm test:postgres`                                                         | **15 passed, 1 file passed** against real PostgreSQL                                                                                                                                   |
| `pnpm test:socket`                                                           | **51 passed, 5 files passed**, real localhost Socket.IO                                                                                                                                |
| `pnpm test:voice`                                                            | **75 passed, 6 files passed**, including protocol, signaling, client lifecycle, UI and ICE config                                                                                      |
| `pnpm build`                                                                 | Pass; all shared packages and both production apps; normal web environment restored after E2E                                                                                          |
| Compiled production migrations                                               | Pass twice against a new database verified to contain zero public tables before migration; four expected tables and exactly one migration record afterward                             |
| Compiled production process smoke                                            | Pass: health contract, four players, match start, same-room voice signaling, shutdown/restart, private-hand recovery, empty restored voice membership, safe logs and graceful shutdown |
| Playwright, all existing projects                                            | **12 passed**: desktop 4/4, tablet 4/4, phone 4/4, no skips; final run 1.4 min                                                                                                         |

Voice-specific tests are a subset of the full Vitest result, as are the PostgreSQL
and Socket.IO suites. The initial full `pnpm test` passed 495 tests; screenshot
review then found a stale disconnect notice after a peer rejoined. That was fixed
with an additional regression test. Final full Vitest was rerun with
`TEST_DATABASE_URL` and `pnpm exec vitest run` after the shared-package/typecheck
build. Full Playwright was rerun after the fix using the explicit capture option
below. No prior assertions were removed or weakened.

The three voice browser scenarios check a four-person room, no capture before
an explicit action, a connected native WebRTC pair on each layout, received audio
RTP packets and attached/playing audio outputs, mute/unmute without reacquisition,
gameplay and chat independence, refresh cleanup, explicit re-enable and leave.
Desktop additionally enables all four microphones and verifies three connected,
receiving peers per client. Phone/tablet exercise touch enable controls, minimum
44-pixel targets and no horizontal overflow. Desktop and phone screenshots were
visually reviewed; the panel stays below the hand and above chat.

Privacy review found no voice logger or database dependency. Socket tests validate
strict server output, derived sender identity, isolated target delivery, stale
ownership and safe error/log content. The PostgreSQL test compares complete room,
player, command and chat rows before/after signaling and verifies an empty voice
roster after server restart. Existing private-projection, reconnect and command
idempotency tests continue to pass.

Coverage includes strict protocol validation; sender/target isolation; spoofing;
queued disconnected ownership; stale sockets and replacement; ephemeral PostgreSQL
state and restart; explicit mic lifecycle and permission failure; delayed work and
cleanup; ICE ordering and peer replacement; localization; autoplay recovery; and
real Chromium RTP/audio output on desktop, tablet and phone layouts.

Browser tests observe native peer connections using test-only wrappers. Default
runs request Chromium fake microphone devices and granted permission. On this
macOS 26.6.2 machine with Chromium 153.0.8010.12, native fake capture returned
`NotSupportedError`; probes using fake UI/full Chromium stalled. The same failure
occurred on a minimal page outside the application. No application restriction was
removed to work around this.

Final browser verification explicitly used:

```sh
DOMINO_E2E_SYNTHETIC_AUDIO=1 pnpm test:e2e
```

This test-only option replaces capture with an oscillator/MediaStreamDestination
created only after the enable action. Peer connections, SDP negotiation, ICE,
encoding, RTP packet transport, remote tracks and audio playback remain native.
There is no automatic fallback and no production test hook. Native microphone
acquisition and real permission UI therefore remain **unverified**; permission
failure/success behavior is covered with controlled unit/UI test doubles.
Tests use `VITE_WEBRTC_ICE_SERVERS=[]` and localhost, so they also do not certify
external STUN/TURN reachability, physical audio quality or mobile OS background
behavior. The annotation in each voice browser result identifies the capture mode.

## Deployment readiness

The implementation and local checks are complete. The project is ready for a
controlled **single-instance staging deployment** after its existing PostgreSQL,
HTTPS/WSS, origin and ICE configuration requirements are supplied. It is **not yet
signed off for broad production voice reliability**: native microphone acquisition,
physical browser/device behavior and restrictive-network/TURN paths need real
deployment validation. TURN is configurable but unprovisioned, and dynamic
short-lived credentials are not implemented. No deployment was started.

## Remaining validation and references

Safari/iOS, Firefox, physical Android/iPhone devices, Bluetooth routing, audio
echo/quality, background suspension, restrictive NAT/firewalls, live TURN and
short-lived credential rotation are not verified. Native-speaker review of RU/AZ
strings and a full assistive-technology audit remain outside automated coverage.
No deployment or production infrastructure verification was performed.

## Recorded placement audio follow-up (2026-10-05)

This follow-up replaces the tile-placement oscillator with rotating recorded-audio
playback, primes its audio elements only after an explicit sound gesture, varies
level by at most 10% and playback rate by at most 2%, and silences/clears playback
when muted or disposed. Placement detection precedes the turn cue so one new board
tile produces one placement cue even when it also changes whose turn it is. Tests
cover mute, media-play rejection, variation bounds, bot/remote snapshot changes,
duplicate revisions, reconnect baselines and browser cue counts through rerender,
reload and new moves.

At the time of this 2026-10-05 entry, recorded files were absent. The user has
since supplied the source recording; the current asset status and extraction
provenance are recorded in [`AUDIO_ASSETS.md`](AUDIO_ASSETS.md).

Verification when this entry was written (2026-10-05):

| Check                                               | Result                                                                                                                                    |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm format:check`                                 | Pass                                                                                                                                      |
| `pnpm lint`                                         | Pass; zero warnings/errors                                                                                                                |
| `pnpm typecheck`                                    | Pass; packages, apps, tools and E2E                                                                                                       |
| `pnpm test` with loopback permission                | **565 passed, 17 skipped**, 45 files passed, 1 PostgreSQL file skipped                                                                    |
| `pnpm test:socket` with loopback permission         | **55 passed**, 6 files passed                                                                                                             |
| `pnpm test:postgres`                                | **Not run**; guard rejected missing `TEST_DATABASE_URL` ending in `_test`; no PostgreSQL client/server or Docker executable was available |
| `pnpm build`                                        | Pass; web/server and migration runner compiled                                                                                            |
| `pnpm test:e2e` with `DOMINO_E2E_SYNTHETIC_AUDIO=1` | **18 passed** across desktop/tablet/phone, including sound and voice scenarios                                                            |
| `pnpm test:e2e` without capture shim                | Native Chromium microphone capture failed as documented above; rerun with the explicit test shim passed                                   |

No migration was applied because there is no dedicated PostgreSQL test database.
With missing sound files and database integration unavailable, this checkout is
**not ready to deploy the recorded-placement-audio update**. The existing Phase 9
voice implementation retains the prior staging limitations and requires the
PostgreSQL, HTTPS/WSS, origin and ICE configuration documented above.

Browser behavior references: [WebRTC specification](https://www.w3.org/TR/webrtc/),
[secure-context microphone access](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia),
[ICE candidate ordering](https://developer.mozilla.org/en-US/docs/Web/API/RTCPeerConnection/addIceCandidate),
[playback promises](https://developer.mozilla.org/en-US/docs/Web/API/HTMLMediaElement/play)
and [TURN guidance](https://webrtc.org/getting-started/turn-server).

## Frontend polish and recorded samples (2026-10-06)

The user-supplied Macif recording is retained as a private source master under
`apps/web/audio-source/`, with five normalized 0.152–0.212 second PCM cues served
from `apps/web/public/audio/domino/`. A Playwright HTTP asset test verifies every
cue is served as short 44.1 kHz stereo 16-bit PCM with its expected peak range.
The main board has a warm walnut table surface, understated perimeter player-arm
illustrations, and a slow smoke accent. Decorative elements do not intercept
input; the smoke respects reduced-motion settings. The existing chain renderer,
game rules, authoritative services, and voice architecture are unchanged.

The pre-existing PostgreSQL integration limitation and deployment requirements
above remain. Browser audio asset validation verifies real shipped recordings and
the web response, but does not replace listening checks on physical speakers.

### Current frontend verification

After the audio and visual changes, the full Vitest suite passed with **565
passed, 17 skipped** across 46 files. Playwright passed **21 tests** on desktop,
tablet and phone with `DOMINO_E2E_SYNTHETIC_AUDIO=1`; this includes HTTP checks of
all five WAV cues and the existing game, reconnect, privacy, reduced-motion and
voice scenarios. Formatting, lint, full workspace typecheck and production build
passed. PostgreSQL integration remains blocked by the absent dedicated
`TEST_DATABASE_URL` (the suite requires a database name ending in `_test`), so no
database migration was applied or verified in this run.
