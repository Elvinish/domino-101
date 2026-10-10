import { render } from '@testing-library/react';
import { expect, it } from 'vitest';
import { BOT_PERSONAS } from '@domino/protocol';
import { playerVisuals } from './playerVisuals';
import { GameTable } from './GameTable';
import { TableScene } from './TableScene';
import { gameFixture, own, roomFixture } from '../test/multiplayer';

it('maps every bot to matching assets without classifying human names', () => {
  const player = roomFixture().seats[1]!;
  for (const persona of BOT_PERSONAS) {
    const visual = playerVisuals({
      ...player,
      kind: 'bot',
      displayName: persona.displayName,
    });
    expect(visual.gender).toBe(persona.gender);
    expect(visual.top).toContain(`top-${persona.gender}.png`);
    expect(visual.grip).toBe(
      persona.gender === 'female'
        ? '/images/lounge/hands-grip-female.png'
        : '/images/lounge/hands-grip.png',
    );
  }
  expect(
    playerVisuals({ ...player, kind: 'human', displayName: 'Лейла' }).gender,
  ).toBe('unspecified');
  expect(
    playerVisuals({ ...player, kind: 'bot', displayName: 'Legacy' }).gender,
  ).toBe('unspecified');
});

it.each([1, 2, 3] as const)(
  'keeps the female persona attached to absolute seat %s through relative layouts and reconnect data',
  (seat) => {
    const room = roomFixture();
    room.seats[seat] = {
      ...room.seats[seat]!,
      displayName: 'Айсель',
      kind: 'bot',
    };
    const game = gameFixture();
    const props = {
      room,
      own,
      game,
      onAction: async () => true,
      disabled: false,
      pending: false,
    };
    const view = render(<GameTable {...props} />);
    for (const ownSeat of [0, 1, 2, 3] as const) {
      if (ownSeat === seat) continue;
      view.rerender(
        <GameTable
          {...props}
          room={structuredClone(room)}
          own={{ ...own, seat: ownSeat }}
        />,
      );
      const scene = view.container.querySelector(`[data-seat="${seat}"]`)!;
      expect(scene).toHaveAttribute('data-persona-gender', 'female');
      for (const source of scene.querySelectorAll('source'))
        expect(source.getAttribute('srcset')).toContain('female.png');
      expect(scene.querySelectorAll('.concealed-tile')).toHaveLength(7);
      expect(scene.querySelectorAll('.pips')).toHaveLength(0);
      expect(view.container.querySelectorAll('.persona-badge')).toHaveLength(1);
    }
  },
);

it('uses female hand assets in the waiting room as well as during play', () => {
  const room = roomFixture();
  room.seats[2] = { ...room.seats[2]!, displayName: 'Гюнай', kind: 'bot' };
  const { container } = render(
    <TableScene room={room} own={own}>
      <span />
    </TableScene>,
  );
  expect(container.querySelector('[data-seat="2"] source')).toHaveAttribute(
    'srcset',
    '/images/lounge/player-top-female.png',
  );
  expect(container.querySelector('.scene-decoration')).toHaveAttribute(
    'aria-hidden',
    'true',
  );
});
