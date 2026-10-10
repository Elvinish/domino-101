# Phone gameplay layout

The mobile shell applies only after a match starts. Entry and lobby keep their
existing layouts. No engine, scoring, server, persistence, bot, networking, voice
or placement-audio behavior is changed.

## Layout modes

- **Phone portrait:** viewport width ≤640 CSS px. Four compact seats share the
  table with the chain and the local hand. Other decorative hands and props are
  hidden; the local grip photo remains behind the tiles, with thumbs in front.
- **Phone landscape:** width ≤1000 and height ≤500 CSS px in landscape, plus
  narrower landscape phones covered by the first rule. Partner above, opponents
  beside the chain, local hand below, local seat at lower left. Up to two small
  props remain outside the playable area.
- **Tablet/desktop:** existing scene and inline controls, without a fixed shell.
  The 820×1180 tablet and 1440×1000 desktop retain their previous presentation.

`mobile.ts` owns the mode query. `mobile-game.css` is imported after the desktop
scene styles and scopes geometry to `.phone-game`. The shell uses `100dvh`, all
four `env(safe-area-inset-*)` values and disables document scrolling only while
the joined match is shown. Leaving the match restores normal page scrolling.

The chain's `ResizeObserver` measures a separately allocated play area in both
dimensions. The existing edge-turn snake algorithm receives its available width
and height; tile order, doubles and end selection are unchanged. The entire UI
is never scaled. Local tile buttons are 44×82 CSS px, HUD buttons are 44×44,
and pass/end-choice controls are at least 48 px high.

## Panels and accessibility

`ResponsivePanel` retains its child components when opened, closed or resized.
Native modal dialogs provide focus containment, Escape/backdrop dismissal and
return focus to the trigger. Visual viewport resize/scroll events bound the
sheet when browser chrome or the on-screen keyboard reduces usable space.
Sheet contents may scroll; the game page does not.

Chat drafts persist, and messages are marked read only while the chat is open.
Voice stays connected while its panel is closed; opening it never enables the
microphone. The menu contains sharing, language, sound, leave controls, full
score details and the server-authorized end-of-round hand reveal. Compact seat
labels retain relation/team/status text for assistive technology. Existing
reduced-motion behavior remains in effect.

## Verification

Automated viewport matrix in `e2e/mobile-game.spec.ts`:

| Viewport                       | Simulated safe insets (top, right, bottom, left) |
| ------------------------------ | ------------------------------------------------ |
| iPhone 12 Pro Max 428×926      | 47, 0, 34, 0                                     |
| iPhone 12 Pro Max 926×428      | 0, 47, 21, 47                                    |
| Small iPhone 375×667 / 667×375 | 0, 0, 0, 0                                       |
| Narrow phone 320×568           | 0, 0, 0, 0                                       |
| Android 393×851 / 851×393      | 0, 0, 24, 0                                      |

The same matrix runs in Chromium and WebKit through a real bot round. Checks
cover all four seats, touch targets, chain containment, page bounds, safe areas,
pass and end-choice actions, result screens, chat drafts and modal dismissal.
Existing desktop/tablet tests cover layout, avatars, keyboard input, multiplayer,
reconnect, privacy, sound and voice. Unit tests cover height-constrained chains,
closed-chat read state and persistent panel children.

Final verification on 2026-10-10 (Node 24):

- Frontend Vitest: **216 passed / 18 files**.
- Prettier, ESLint and full workspace TypeScript checks: passed.
- Production build: passed; Vite retains the existing >500 kB chunk warning.
- Full Playwright run: **34 passed, 1 failed, 2 skipped**. The failure was an
  obsolete desktop privacy assertion forbidding the already-authorized final
  hand reveal. After updating that assertion, the full desktop match/privacy
  scenario passed (**1/1**). Thus all **35 applicable scenarios** have passed;
  the two skips are the phone-only matrix under desktop/tablet projects.
- Final pip-grid correction: Chromium + WebKit phone matrix **2/2 passed**
  (58.0 s), including all seven sizes, avatar dismissal, controls and safe areas.

The checks also exposed a stale room-full message expectation and a resize test
that sampled the hands before React switched layout modes; both tests were
corrected and passed on rerun. A real WebKit rendering problem was fixed by
giving the mobile tile halves flexible grid sizes, keeping every pip inside the
tile. No application behavior was changed to satisfy obsolete expectations.

Screenshots are in ignored `test-results/`: `desktop-home-playing.png`,
`tablet-home-playing.png`, `phone-iphone-max-portrait.png`,
`phone-iphone-max-landscape.png` and equivalent `phone-webkit-*` captures.

Physical iPhone Safari/Android Chrome, the actual OS keyboard and native browser
toolbar collapse have not been tested on hardware. WebKit emulation and injected
safe-area values do not replace that hardware check. Voice E2E uses the existing
explicit synthetic-capture option on this host; hardware microphone quality and
mobile background behavior remain outside this frontend verification.
