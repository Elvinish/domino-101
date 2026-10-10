import { expect, it } from 'vitest';
import { choosePersonaName, PERSONA_NAMES } from './personas.js';
import { findBotPersona } from '@domino/protocol';

it('ships 250–400 unique human names without generated suffixes', () => {
  expect(PERSONA_NAMES.length).toBeGreaterThanOrEqual(250);
  expect(PERSONA_NAMES.length).toBeLessThanOrEqual(400);
  expect(new Set(PERSONA_NAMES).size).toBe(PERSONA_NAMES.length);
  for (const name of PERSONA_NAMES) {
    expect(name).toMatch(/^\p{L}+(?:[-’]\p{L}+)*$/u);
    expect(findBotPersona(name)).toMatchObject({
      displayName: name,
      playerType: 'bot',
    });
  }
});
it('excludes human and automated names case-insensitively, including near exhaustion', () => {
  const occupied = PERSONA_NAMES.slice(1).map(
    (name) => ` ${name.toLocaleLowerCase('ru')} `,
  );
  expect(choosePersonaName(occupied)).toBe(PERSONA_NAMES[0]);
  const room = [PERSONA_NAMES[0]!];
  for (let seat = 1; seat < 4; seat++) room.push(choosePersonaName(room));
  expect(new Set(room).size).toBe(4);
});
