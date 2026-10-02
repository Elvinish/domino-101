# Phase 7 — localization, accessible UX and sound

## Scope

Phase 7 builds on the existing game, room, reconnect and chat architecture. No
engine, bot, server, protocol, rules, identity, revision, idempotency or room
isolation behavior changed. Persistence and voice remain outside this phase.

## Localization

`apps/web/src/i18n/en.ts`, `ru.ts` and `az.ts` hold named translation resources
for English, Russian and Azerbaijani. English defines the `MessageKey` type;
Russian and Azerbaijani must implement exactly the same keys. Tests also compare
interpolation placeholders and cover every protocol error code.

`i18n/index.ts` provides the typed translator and context. `Provider.tsx` owns the
language preference and updates the HTML `lang` attribute. English is the safe
default. The header's native select changes the language immediately without
reloading. `domino101.language` stores only `en`, `ru` or `az` in localStorage.
Invalid or denied storage falls back safely; choosing a language still works in
memory when writes are denied.

Entry, lobby, seats, team/score states, legal actions, results, connection states,
chat, reactions, errors and accessibility text use these resources. Player names,
room codes, team identifiers and tile values remain unchanged. Text parameters
are interpolated once and rendered by React as text, never parsed as HTML.
Unknown message keys use a generic localized error without displaying the key or
raw error. Transport state now holds message keys instead of English sentences,
so an error already on screen also changes language. Credentials stay outside
that state as before.

## Sound

`apps/web/src/sound/service.ts` owns Web Audio independently of React. It exposes
semantic cues for your turn, a placed tile, a round result and a match result.
Short sine tones use a low gain, last 80–250 ms, and need no downloads, external
services, microphones or real audio hardware in tests.

Sound is muted by default. The explicit sound button persists `on` or `off` in
`domino101.sound`. A saved opt-in never creates an AudioContext during startup:
a click or key gesture inside the app unlocks audio for that page. Unsupported
APIs or rejected resume requests produce a localized notice. Muting and unmounting
stop and disconnect oscillators/gains and close the context.

`CueTracker` consumes only public game projections, own seat and revision. It
ignores duplicate or old snapshots, makes initial/reconnect snapshots silent
baselines, and chooses one cue per update. Match and round results take priority
over turn and tile cues. Chat, language changes and unrelated renders never
replay sounds. No sound event mutates authoritative state.

## Accessibility and state clarity

- A keyboard skip link leads to the current main landmark. The language selector,
  sound toggle, chat toggle and gameplay controls use native semantic controls.
- Player seats show You / Partner / Opponent, team, connection and turn text.
  The active seat also uses an outline, underlined status and `aria-current`;
  your own seat is bordered and an offline seat has a dashed border.
- Playable, unavailable and selected tiles have distinct outlines and marks,
  localized accessible descriptions and the existing `aria-pressed` state.
  During a pending command the hand is `aria-busy`, actions stay disabled and a
  visible localized sending status appears. There is no optimistic tile removal.
- Choosing a tile with two legal ends moves focus to the first end button.
  Escape or Cancel returns focus to the tile without submitting a move.
- `Feedback.tsx` and `tableStatus.ts` provide a stable, localized polite live
  region for turn, disconnection, starter selection and round/match results.
  Repeated snapshots and chat updates do not replace unchanged announcement text.
  This region receives only safe public display data.
- Reconnecting attempts, exhausted retries, restoring a seat and replacement by
  another tab are distinct. Existing Socket.IO manager events drive presentation
  only; listeners are removed on disposal. The Phase 5 reconnect protocol,
  credentials, retry policy and newest-socket ownership remain intact.
- Errors are localized alerts; social errors appear beside the chat composer.
  A social acknowledgement timeout explains that the message is unconfirmed;
  drafts survive rejections. Unknown exceptions, stack traces and secrets never
  become UI or accessibility content.

## Responsive layout and reduced motion

The felt green table and ivory tiles remain. The header, share controls, seats and
score panel wrap translated text. On narrow screens, the board uses the available
width, the partner stays above it, opponents share a row and your own seat sits
below. The hand wraps with touch targets at least 44 pixels wide/high. Chat remains
in document flow below the hand, so it cannot cover game actions.

The viewport includes `viewport-fit=cover`; body padding respects safe-area insets
and uses dynamic viewport height. Phone landscape has shorter table rows. Both
transitions and animations are disabled for `prefers-reduced-motion: reduce`, as
are hover/selected tile movement and smooth scrolling. Focus outlines remain.

## Chat polish

The collapse control has an expanded state and controlled-panel relationship.
Messages show locale-formatted timestamps and wrap long plain text with preserved
newlines. Scroll tracking uses the newest message ID, so it keeps working after
the 50-message cap is reached. New messages scroll only when the reader is already
at the bottom; otherwise the unread count and Jump to latest button remain. The
message list is keyboard-scrollable. Expanding marks the visible history read.

Enter sends; Shift+Enter inserts a line break; an IME composition does not submit.
The composer shows the 500-character limit, retains edits made during a request,
and prevents duplicate submissions. Reactions use localized names, 44-pixel touch
targets and a short-lived status. Offline sending is disabled. The same chat panel
survives the lobby-to-game transition, preserving its draft and expanded state.
Room history, rate limits, validation and server sender attribution are unchanged.

## Privacy audit

No new code logs payloads or reads opponents' private hands. The sound tracker is
given public projections only. Local preference keys contain a language code or
sound flag; the existing private session store is unchanged. No reconnect token,
socket identity or internal match state is added to DOM, data attributes, live
regions, errors or translation diagnostics. Text and display names use normal
React escaping; no `dangerouslySetInnerHTML`, remote audio or tracking is used.

Existing browser and Socket.IO privacy suites are preserved. The new browser
scenario checks all clients' DOM for credentials and opponents' tile controls,
uses a separate room to check chat isolation, renders an HTML-like chat message
as text, and verifies recovered history after a real page refresh.

## Verification

The final verification run produced these results:

- `pnpm install --frozen-lockfile --offline --store-dir /Users/Elvin/Library/pnpm/store` passed after the existing pnpm-store symlink required an approved escalated run.
- `pnpm format:check` passed.
- `pnpm lint` passed with zero warnings.
- `pnpm typecheck` passed, including the web, server, packages, tools and E2E TypeScript projects.
- Full Vitest passed: **392 tests in 32 files**.
- Web-focused Vitest passed: **82 tests in 9 files**.
- Socket.IO integration passed: **44 tests in 4 files**.
- Production package and application build passed, including the Vite production bundle and server build.
- Playwright passed: **9 tests across desktop, tablet and phone projects**. The suite covered language persistence, sound opt-in, responsive layouts, reduced motion, chat history/isolation, lobby-to-game draft retention, keyboard actions and privacy checks.
- Screenshot review passed for desktop, phone portrait and phone landscape captures.

The earlier Phase 6 EPERM/approval-quota failures remain historical facts. This
phase obtained permission for the existing pnpm store and localhost test servers;
its successful results do not retroactively change the Phase 6 record.

## Unverified and readiness

Chromium runs use desktop/tablet/phone emulation, with additional 320px portrait
and phone landscape checks. The final Playwright rerun after the last assertion
could not be started because the environment approval reviewer reported the
account usage limit; the recorded 9-test pass is from the completed suite before
that final assertion-only edit, and the E2E TypeScript check passed afterward.
Physical devices, Safari/Firefox, real screen-reader speech, audible output
quality on hardware and native-speaker translation review are not independently
verified. Automated tests use fake audio nodes and do not require microphones or
speakers.

No PostgreSQL/Drizzle, migrations, accounts, voice/WebRTC, TURN, hosting or domains
were added. Single-process, in-memory room/chat/session limitations remain. Phase
8 may begin only after explicit instruction; this report is not production
publication or deployment approval.
