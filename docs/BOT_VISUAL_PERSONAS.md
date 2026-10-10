# Visual bot personas and seated players

## Data and stability

`packages/protocol/src/personas.ts` is the shared immutable catalog: **340**
fictional personas, each with `displayName`, authored `gender` (185 male / 155
female), and `playerType: 'bot'`. It retains the existing CIS/Azerbaijani name
pool. Gender is data, not a name-ending heuristic or avatar classifier.

The existing server `rooms/personas.ts` selects names from this catalog with the
same random selection and occupied-name exclusion. Membership already persists
`displayName` and `kind`; these identify the catalog entry on reload/restore.
No protocol payload, DB schema, migration, persistence path, game engine or bot
strategy changes are needed. Reconnect does not reroll a persona. Existing
natural names keep their identity. Legacy/unknown names and human memberships
use an unspecified-gender default visual; human names/photos are not classified.

## Presentation

`apps/web/src/components/playerVisuals.ts` maps bot metadata to a small visual
registry, also providing a future adapter point for avatar/outfit assets. A subtle
localized accessible AI badge identifies every automated seat without changing
its actual display name.

The top seat now has a coherent photographic chest, sleeves, forearms and hands,
with male/female variants. In a match, a fixed chest fills the middle and softly
masked photo halves follow the shrinking domino fan. Thumb overlays touch the
outer tile edges. Cloth overlap joins the moving arms to the chest; hands never
stretch. An empty top hand retains the seated figure. The lobby uses the same
whole upper-player image, positioned clear of the central start controls.

Side seats retain their table-midpoint anchors and natural ±90° orientation,
using the female grip image for female personas. Forearms extend beyond the
scene crop. Badges stay in the outer seat gutters; tablet board margins reserve
space so even a long chain cannot run behind a badge. The local first-person grip, snake algorithm and pass controls are
unchanged. All images are decorative, non-interactive and absent from accessibility
content. Phone media sources stay on the empty SVG rather than downloading the
large decorative photographs; reduced motion disables grip/ambient animation.

New production assets in `apps/web/public/images/lounge/`:

- `player-top-male.png`
- `player-top-female.png`
- `hands-grip-female.png`

The existing wood, warm lighting, scenery and safe prop pockets are retained.
The reference screenshot itself is not used as a scene background.

## Avatar popup

The previous correction in `PlayerAvatar.tsx` is retained: successful image
processing AND local storage write update the avatar, clear the input, close the
native details popup and restore trigger focus. Successful removal closes it too.
Errors stay visible with the popup open. Escape, Cancel, outside click and the
trigger invalidate pending processing so a late result cannot save after cancel.
This remains local browser storage, not a network upload.

## Coverage

Catalog tests cover all 340 metadata records and explicitly gendered names from
several cultures. Frontend tests check every persona's asset mapping, all relative
seat positions, rerender/reconnect data, lobby assets and the absence of foreign
pips during play. Room restore tests check that the same persisted membership
resolves to the same persona. The existing avatar tests cover success, deletion,
storage/decode errors and cancellation of in-flight work.

Browser checks cover actual bot rounds, responsive chain/seat clearance, sleeve
roots, phone asset suppression, AI badges, reduced motion, avatar dismissal and
the waiting room. An existing invitation integration test now awaits the host's
snapshot before comparing clients: a guest acknowledgement cannot guarantee
delivery order on a different socket. No runtime networking change was made.

## Asset provenance

Generated with the built-in imagegen tool as transparent PNG edits of the existing
project hand images, then copied into the public directory. The reference is
style guidance only. Exact prompts follow.

### Top male

Use case: precise-object-edit. Asset type: transparent photographic decorative seated upper player for a domino web game. Edit target is hands-across-table-extended.png. Preserve the exact two healthy adult male hands, positions, size, warm skin tone, thumbs at x~42%/58%, y~80%, and five fingers. Make the upper figure a coherent casually dressed seated man, by adding a dark olive cotton shirt TORSO connecting the two existing rolled sleeves across the whole upper/central region. Shoulders and chest must be connected to arms, naturally bent elbows, a single seated person leaning comfortably toward the table. Crop the head OUT above the upper border; no face. The torso should fill the large black/transparent gap between sleeves from top down to y=64%, with a soft cloth hem at y=66%, while hands still extend to y=94%. Square image. Same framing and hand anatomy as target. Transparent cutout outside the single body/arms/hands and below the torso; especially the gap between hands at bottom stays transparent for real UI domino tiles. No dominoes, no table, no props, no background, no typography, no glow. Photorealistic cozy warm indoor lighting, natural clothing folds. Do not shrink the hands or add any fingers.

### Top female

Use case: precise-object-edit. Asset type: transparent photo cutout of seated upper player for domino game. Edit target attached male torso/arms. Create the matching ADULT FEMALE variant. Keep exact square canvas, framing, silhouette extents, inward cupped grip, hand positions at bottom x~30% and70%, thumb tips x~42% and58% y~84%, transparent gap between hands. One adult woman wearing a modest relaxed dusty plum knitted long sleeve top, sleeves naturally pushed to forearms, feminine slender healthy wrists/hands, short natural unpainted nails, normal five fingers on each hand. Her torso and shoulders connect coherently to both bent arms. Head and face cropped OUT at upper border; no jewelry, no sexualization. Same warm household evening light and realistic skin/cloth texture as target. No tiles or any objects, no table, no room/background. True alpha transparency outside body and between hands below torso, no halo. Arms must not float separately from body.

### Female grip

Use case: precise-object-edit. Asset type: transparent photographic hands for interactive domino UI. Create a matching ADULT FEMALE variant of the attached hands-grip.png. Preserve EXACT 3:2 landscape canvas, pose, hand positioning, empty central gap, perspective and sizing: two cupped hands at upper left/right, horizontal thumb tips at x43% and57%, y32%; fingers behind invisible domino row, forearms entering and continuing through lower corners. Healthy slender adult female hands/wrists, five natural fingers per hand, short clean unpainted nails; modest dusty plum knitted sleeves at bottom corners. Warm household evening light. Keep hands large and anatomy natural, not zombie or outstretched flat palms. Remove the brown glow around arms: genuine transparent background around arms and throughout middle gap, no shadow halo, no table, no body, no face, no dominoes, no objects, no text. Render only two real hands and forearms with cuff ends cropped by bottom edge. Keep exact geometry so existing CSS thumb masks still fit.
