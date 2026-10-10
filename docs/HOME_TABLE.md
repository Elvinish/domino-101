# Home table scene — 2026-10-07

The Cozy Multiplayer Domino Night reference guides the composition, not a
background image. The furniture is a CSS layered wooden tabletop using the
existing walnut texture, a modest edge and contact shadows. There is no felt,
billiard rail or inset playing card. The surrounding dark patterned floor and
warm lighting keep attention on the board.

## Frontend boundaries

- `TableScene.tsx` positions four paired-hand transparent assets relative to
  the user's seat. Only public turn state drives the quiet hand movement.
- Opponent backs use `public.handCounts` only. They contain no pips, values or
  private-hand information. Empty hands display no backs.
- `GameTable.tsx` places the actual selectable hand inside the table, in front
  of the lower hands. A slight static fan keeps tiles legible. Disabled tiles
  remain opaque; existing outlines, markers, keyboard handling and labels
  distinguish legal actions.
- `table-scene.css` owns the original straight tabletop, bevel, patterned floor
  and shared hand, steam and tile animation rules. `seated-scene.css` keeps
  match-only hand/control spacing and responsive layers, without a camera transform.
  Decorations are aria-hidden and never receive pointer events.
- Existing single-new-tile settle animation and its baseline/reconnect guards
  remain intact. No recorded audio playback code is changed.
- At tablet widths hands remain and props shrink. At <=640px photographic
  decoration is hidden and picture sources use the tiny empty SVG instead.
  The table, avatars and all controls remain. Reduced motion disables hand,
  steam and placement animation.
- Rules, scoring, persistence, bots, server, networking and WebRTC are untouched.

## Avatars

`PlayerAvatar.tsx` provides initials, image-error fallback and a keyboard-operable
photo menu for the local user. `avatar.ts` accepts PNG/JPEG/WebP up to 5 MB, rejects
empty files, other formats and decoded images over 24 megapixels, then crops
centrally and encodes a 128×128 JPEG. Object URLs are released on success/failure.
Generation guards prevent a stale decode from replacing a removed photo.

The photo is stored under `domino101.avatar` in browser localStorage, separate
from room/session data. It is not sent to other players or included in messages,
logs or private snapshots. Storage/decoding failures show a localized message.
The UI explains this local-only behavior in EN/RU/AZ. Clearing browser data removes
the photo. The optional `Seats.avatars` map and `PlayerAvatar.imageUrl` prop are
the adapter point for a future profile service. Shared profile uploads require
separately authorized backend work; this change does not add it.

## Generated assets

Built-in image generation mode, transparent backgrounds. The reference itself
is not shipped as a background. The seated match uses:

- `apps/web/public/images/lounge/hands-grip.png` for the local player's
  two-handed fan
- `apps/web/public/images/lounge/hands-across-table-extended.png` for opponent
  grips, including the sleeves that continue beyond the scene crop

The earlier `home-evening.png` backdrop is no longer used by the scene; the
original patterned floor surrounds the table in both lobby and match.

The PNGs are decorative presentation only; tile values and controls remain
DOM-rendered. Existing `walnut.png` and `empty.svg` are reused, while the
three-quarter props are rendered as maintainable SVG in `TablePropArt.tsx`.
Static hosting should apply normal cache headers to the generated PNGs.

## Held domino integration

During a match, `HeldTiles.tsx` groups the actual tile row and two independently
anchored hand halves. The photographed fingers sit behind the row; CSS-clipped
copies of just the thumbs sit in front of the outer bottom edges. The hands
follow the row's width as its tile count changes, rather than remaining at
fixed coordinates around a floating row. Small overlap and rotation form a fan.
Local pips remain visible and legal-action marks sit above the fan; thumb layers
ignore pointer events and are hidden from assistive technology.

`GameTable.tsx` renders the selectable local row inside the grip. `TableScene.tsx`
uses the same composition for the other three seats, drawing only backs from
public hand counts. A zero count hides the gripping photo layers. The lobby
retains its existing hands and positioning. Phones retain wrapping touch targets
and omit the photographic layers; reduced motion disables the entire grip's
small turn animation so the fingers and tiles always move together.

The generated hand layers are cached by URL; no reference
image is shipped. The local hand uses `hands-grip.png`; side bots use the male or
female grip selected by their persona, and the top seat now uses a connected
male/female torso and arms. See [visual personas](BOT_VISUAL_PERSONAS.md) for the
current asset registry, prompts and checks. Remote seats still show only concealed
backs during play.

### Straight-table restoration — 2026-10-09

This is a targeted partial revert of the perspective presentation, not a new
reconstruction. The tabletop and surrounding floor already survived in
`table-scene.css` from commit `4cc86e7` and match the supplied waiting-room
screenshot. `TableScene.tsx` no longer inserts the separate transformed furniture
layer. Removing the camera, background and furniture overrides in
`seated-scene.css` lets the match reuse that original rectangular surface, edge
highlights and shadows. No legacy files were replaced wholesale.

Current connected top torsos, centered side grips, local tile/thumb composition,
personas, avatars and safe control spacing are retained. Lobby positioning and
game mechanics are unchanged. Browser coverage compares the tabletop width,
surface and untransformed geometry before and after starting a match, in addition
to existing chain clearance, hand alignment and real-round checks.

Verification for this restoration: **214/214 frontend Vitest tests** across
17 files and **12/12 Playwright scenarios** (bots, avatars, lobby and polish on
desktop/tablet/phone) passed. ESLint and frontend/e2e TypeScript checks passed.
Desktop, tablet and phone screenshots were inspected, including an ended round
with a long chain. Production web build and formatting passed; the existing
bundle-size warning remains. Backend and PostgreSQL suites were not rerun for
this presentation-only revert.

### Earlier side-seat alignment and avatar popup — 2026-10-09

Match-only rules in `seated-scene.css` now anchor both side grips to the table's
vertical midpoint, shared with the corresponding seat badges. The compact
original hand photograph rotates ±90° toward each seat and preserves its aspect
ratio; the earlier long-sleeve ±65°/70° arrangement is no longer used on the sides.
Both photo halves and their thumb masks follow the fan as the tile count changes.
The forearm roots extend beyond the side scene boundaries, with `overflow: clip`
and the existing vignette hiding the joins without stretching skin. Top and local
grips retain their existing composition. Badges sit below the side fans; desktop
props move to upper edge pockets so longer rounds cannot push badges into them.
Tablet reserves extra chain clearance and moves hand instructions inward. The
lobby and compact phone presentation remain unchanged. Decorative layers keep
`pointer-events: none` and the existing reduced-motion behavior.

`PlayerAvatar` closes its native details popup after a successful storage write
or removal, updates the face immediately, clears the file input and restores
focus to the avatar trigger. Processing or storage failures keep the popup open
with an error and preserve the saved photo. Escape, Cancel, outside pointer
interaction and clicking the avatar again close the popup and invalidate pending
image processing, so a late result cannot save after cancellation. Avatars remain
browser-local; this does not introduce profile uploads or network changes.

Verification: **209/209 frontend Vitest tests**, **12/12 Playwright scenarios**
(avatar, bots, lobby layout and polish across desktop/tablet/phone), ESLint,
frontend/e2e TypeScript checks and the production web build passed. Formatting
passed for the changed files. Browser runs include real bot rounds, reduced
motion, keyboard controls, pass-button visibility, chain bounds, sleeve roots,
side-seat centering and popup success/error/dismissal. Desktop, tablet and phone
screenshots were visually inspected. The web build retains its existing chunk
size warning. Backend and database integration suites were not rerun for this
frontend-only correction.

The new transparent square asset was created with the built-in `imagegen`
tool from the existing opponent-hand photograph; it is saved in the project's
public images directory rather than referenced from the generation cache.

Exact edit prompt:

> Use case: precise-object-edit. Asset type: transparent photographic game UI hand layer. Edit target is attached hands-across-table.png. Preserve the two healthy adult hands, their inward cupped relaxed domino-holding gesture, skin tone, lighting, and large empty transparent gap between them. Change ONLY framing and extend the forearms and natural olive cotton shirt sleeves UPWARD so both arms continue all the way beyond the TOP image border, without floating cropped ends. Use a SQUARE canvas. Hands must be near the BOTTOM: fingertips near y=88%, thumbs near y=76%, wrists around y=65%. Left hand fingertips reach x=39%, right fingertips x=61%; left sleeve enters top at x=12%, right sleeve at x=88%. Naturally bent full forearms, long real wrinkled shirt sleeves in upper half, subtle taper and cloth folds, not straight tubes. Sleeves become broader toward upper image edge. Keep each arm in its own left/right half so it can be split at 50%. Exactly two hands, five fingers each, no dominoes or any objects. True transparent background including the large gap, no colored halo, no table, no body, no face, no text. Warm evening light, natural photographic material. The application places real dominoes between the thumbs. This asset must allow the forearms to extend offscreen while preserving realistic hands at the bottom of the canvas.

Exact prompt:

Use case: photorealistic-natural. Asset type: transparent PNG game UI layer, two adult hands and forearms holding an INVISIBLE row of domino tiles. Exactly two normal healthy hands viewed from overhead, short rolled dark navy cotton sleeves at lower left and lower right corners. Forearms rise diagonally toward center. Hands form a relaxed precise grip around the lower left and lower right corners of an invisible rectangular row occupying the upper central third of the image. Both THUMBS extend inward nearly HORIZONTALLY across the lower front edge of that invisible row, thumb nails visible from overhead; index and middle fingers curl behind the invisible row's outer edges. The right hand mirrors the left. Hands close enough that thumb tips reach approximately x=36% and x=64% of image width, y=35% of image height. All other fingers anatomically natural and curled, no extra fingers. Keep upper middle and center gap transparent. No actual dominoes, no tiles, no objects at all: the real domino UI will be inserted later between the fingers. Landscape composition, forearms end at bottom corners, wrists near x=25% and 75%, y=55%. Warm household evening lamplight, realistic photographic skin texture and soft self-shadows. Medium warm olive skin. True transparent background, no table, no opaque background, no glow, no halo, no face/body, no text. Not hovering outstretched hands, not open zombie palms. A natural close cupped holding grip with prominent inward horizontal thumbs.

Verification for this update covers shrinking hands (7, 1, 0), public-only backs,
decorative accessibility, real bot rounds, unobstructed chain geometry, pointer
events, keyboard selection, privacy and reduced motion across desktop/tablet/phone.
The final run passed **192 frontend Vitest tests** and **9 Playwright scenarios**
(bots, lobby layout and polish on all three viewport projects). Lint, full
workspace typecheck, production build and formatting passed. Desktop and tablet
screenshots confirm thumbs touching the fan edges; the phone keeps the existing
compact presentation. Backend/database suites were not rerun for this visual
change. An earlier browser attempt was discarded after a concurrent production
build overwrote its test API URL; the isolated rerun passed all nine scenarios.

### Exact generation prompts

Dark sleeves:

Use case: photorealistic-natural. Asset type: transparent PNG decorative pair of hands for a cozy home domino game. Exactly TWO realistic adult hands and forearms viewed overhead. Forearms enter from bottom left and bottom right corners in relaxed V shape. Hands near upper left and upper right, gently cupped inward toward each other, thumbs curved on inner edges as if supporting a fan of dominoes, but NO DOMINOES or objects. Leave a broad clear transparent space between hands and the entire upper middle area so an interactive row of domino tiles can be composited there. Natural healthy warm olive skin, soft wrinkles, correct five fingers per hand. Rolled dark navy cotton sleeves visible at bottom ends of forearms. Casual relaxed friendly home evening, warm soft lamplight from left, realistic photographic skin. Wide landscape composition, balanced hands near left/right thirds. True transparent background, only two forearms and hands; no surface, no glow halo, no person body, no face, no table, no background, no props, no text. Not outstretched zombie hands: relaxed curled holding pose.

Linen sleeves:

Use case: photorealistic-natural. Asset type: isolated transparent photographic layer for a cozy home domino table UI. TWO realistic adult hands and short forearms in a relaxed holding gesture, viewed directly overhead. Forearms enter bottom left and bottom right; fingers curl naturally inward near upper left and upper right to cup an invisible domino fan, thumbs nearest central gap. Wide empty transparent gap in the middle for real UI dominoes, NO dominoes in the image. Warm medium-brown natural skin, gentle tendons, healthy fingers with correct anatomy. Rolled soft oatmeal linen sleeves at the lower edges. Soft evening household lamplight from upper-left, natural colors, gentle self shadows, no jewelry. Landscape composition with cropped sleeve ends and all fingers visible. True transparent background: no table, no floor, no body, no faces, no text, no objects, no background halo. Natural cozy seated player pose, not flat outstretched fingers.

## Verification

Regression coverage includes public-only concealed counts, own-hand integration,
relative turn mapping, initials and image failure, local-only photo visibility,
format/size rejection and upload errors. Browser tests decode a real PNG, confirm
128×128 output, reload persistence and removal on desktop/tablet/phone.
Existing browser scenarios check responsive chain geometry, unobstructed tiles,
non-interactive decoration, reduced motion, bots, reconnect, chat, audio and voice.

Final run results are recorded in `PHASE_9.md`.

## Files for this home-scene update

- `apps/web/src/components/TableScene.tsx`
- `apps/web/src/components/GameTable.tsx`
- `apps/web/src/components/Seats.tsx`
- `apps/web/src/components/PlayerAvatar.tsx`
- `apps/web/src/avatar.ts`
- `apps/web/src/table-scene.css`
- `apps/web/src/seated-scene.css`
- `apps/web/src/i18n/en.ts`, `ru.ts`, `az.ts`
- `apps/web/src/components/GameTable.test.tsx`
- `apps/web/src/components/PlayerAvatar.test.tsx`
- `e2e/bots.spec.ts`, `e2e/avatar.spec.ts`
- The three PNG layers listed above, `README.md`, this document and `PHASE_9.md`

The existing scene import in `main.tsx`, lobby integration in `Room.tsx`,
baseline-aware `DominoChain` animation/tests and removal of obsolete CSS arm
shapes were already present when this update began and are retained.
