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
- `table-scene.css` owns the furniture, responsive layers, steam and shadows.
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
is not shipped as a background. Two generated layers are saved at:

- `apps/web/public/images/lounge/hands-home-dark.png` (1774×887)
- `apps/web/public/images/lounge/hands-home-linen.png` (1536×1024)

The PNGs are reused for opposite seats. Existing `walnut.png`, `coffee.svg`,
`drink.svg` and `empty.svg` are reused. Old lounge assets are not referenced by
the new scene. Hand photos total approximately 2.6 MB and are cached by URL;
production static hosting should apply appropriate cache headers.

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
- `apps/web/src/i18n/en.ts`, `ru.ts`, `az.ts`
- `apps/web/src/components/GameTable.test.tsx`
- `apps/web/src/components/PlayerAvatar.test.tsx`
- `e2e/bots.spec.ts`, `e2e/avatar.spec.ts`
- The two PNG layers listed above, `README.md`, this document and `PHASE_9.md`

The existing scene import in `main.tsx`, lobby integration in `Room.tsx`,
baseline-aware `DominoChain` animation/tests and removal of obsolete CSS arm
shapes were already present when this update began and are retained.
