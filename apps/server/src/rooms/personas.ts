import { randomInt } from 'node:crypto';

import { BOT_PERSONAS } from '@domino/protocol';

/** Preserve the existing name-selection/persistence path. Metadata is shared. */
export const PERSONA_NAMES: readonly string[] = Object.freeze(
  BOT_PERSONAS.map((persona) => persona.displayName),
);

/** Called only when a new automated membership is created, before persistence. */
export function choosePersonaName(occupied: readonly string[]): string {
  const normalized = new Set(
    occupied.map((name) => name.trim().toLocaleLowerCase('ru')),
  );
  const available = PERSONA_NAMES.filter(
    (name) => !normalized.has(name.toLocaleLowerCase('ru')),
  );
  const pool = available.length ? available : PERSONA_NAMES;
  return pool[randomInt(pool.length)]!;
}
