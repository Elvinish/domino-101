import { expect, it } from 'vitest';
import { BOT_PERSONAS, findBotPersona } from './personas.js';

it('ships an explicit immutable visual identity for every built-in bot', () => {
  expect(BOT_PERSONAS).toHaveLength(340);
  expect(new Set(BOT_PERSONAS.map((p) => p.displayName)).size).toBe(340);
  for (const persona of BOT_PERSONAS) {
    expect(persona.playerType).toBe('bot');
    expect(['male', 'female']).toContain(persona.gender);
    expect(Object.isFrozen(persona)).toBe(true);
    expect(findBotPersona(persona.displayName)).toBe(persona);
  }
});

it('uses authored gender for culturally varied names, with no name heuristics', () => {
  for (const name of ['Лейла', 'Айсель', 'Гюнай', 'Сезим', 'Нино', 'Гаяне'])
    expect(findBotPersona(name)?.gender).toBe('female');
  for (const name of ['Рашад', 'Мурад', 'Никита', 'Бека', 'Туран', 'Карен'])
    expect(findBotPersona(name)?.gender).toBe('male');
  expect(findBotPersona('Unknown name')).toBeUndefined();
  expect(findBotPersona('Domino 2')).toBeUndefined();
});
