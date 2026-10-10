import { findBotPersona, type RoomSnapshot } from '@domino/protocol';

/** Registry is also the adapter point for future persona avatars/outfit styles.
 * Human names and uploaded pictures never determine gender. */
const styles = {
  male: {
    grip: '/images/lounge/hands-grip.png',
    top: '/images/lounge/player-top-male.png',
    lobby: '/images/lounge/hands-home-linen.png',
  },
  female: {
    grip: '/images/lounge/hands-grip-female.png',
    top: '/images/lounge/player-top-female.png',
    lobby: '/images/lounge/hands-grip-female.png',
  },
} as const;

export function playerVisuals(player: RoomSnapshot['seats'][number]) {
  const persona =
    player?.kind === 'bot' ? findBotPersona(player.displayName) : undefined;
  const gender = persona?.gender ?? 'unspecified';
  return { gender, ...styles[persona?.gender ?? 'male'] };
}
