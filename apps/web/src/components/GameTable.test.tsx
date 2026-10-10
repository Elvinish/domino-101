import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { GameTable } from './GameTable';
import { gameFixture, own, roomFixture } from '../test/multiplayer';
import type { GameSnapshot } from '@domino/protocol';

function setup(game = gameFixture(), disabled = false, pending = false) {
  const onAction = vi.fn().mockResolvedValue(true);
  const props = { room: roomFixture(), own, game, disabled, pending, onAction };
  const view = render(<GameTable {...props} />);
  return { ...view, onAction, props };
}
describe('authoritative table presentation and controls', () => {
  it.each(['round-ended', 'match-finished'] as const)(
    'reveals exact seat hands only in %s, then hides them for a new round',
    (phase) => {
      const game = gameFixture();
      game.public.phase = phase;
      game.public.handCounts = [7, 2, 0, 1];
      game.public.revealedHands = [
        game.private.hand,
        ['0:1', '2:2'],
        [],
        ['6:6'],
      ];
      const f = setup(game);
      expect(
        Array.from(
          f.container.querySelectorAll('.scene-player--left .revealed-tile'),
        ).map((tile) => tile.getAttribute('aria-label')),
      ).toEqual(['0:1', '2:2']);
      expect(
        f.container.querySelectorAll('.scene-player--top .revealed-tile'),
      ).toHaveLength(0);
      expect(
        f.container.querySelector('.scene-player--right .revealed-tile'),
      ).toHaveAttribute('aria-label', '6:6');
      expect(
        f.container.querySelectorAll('.remote-grip .concealed-tile'),
      ).toHaveLength(0);
      expect(
        f.container.querySelectorAll('.seat-reveal .revealed-tile'),
      ).toHaveLength(3);
      // Even a malformed active snapshot must not reveal through the view helper.
      f.rerender(
        <GameTable
          {...f.props}
          game={{ ...game, public: { ...game.public, phase: 'playing' } }}
        />,
      );
      expect(f.container.querySelectorAll('.revealed-tile')).toHaveLength(0);
      expect(
        f.container.querySelectorAll('.remote-grip .concealed-tile'),
      ).toHaveLength(3);
    },
  );
  it('keeps the grip attached to its tile row as hands shrink, without inventing hidden faces', () => {
    const game = gameFixture();
    const f = setup(game);
    for (const count of [7, 1, 0]) {
      const next = {
        ...game,
        private: { ...game.private, hand: game.private.hand.slice(0, count) },
        public: {
          ...game.public,
          handCounts: [count, count, count, count] as [
            number,
            number,
            number,
            number,
          ],
        },
      };
      f.rerender(<GameTable {...f.props} game={next} />);
      const local = f.container.querySelector('.local-grip')!;
      expect(local.querySelectorAll('.hand-tile')).toHaveLength(count);
      expect(local.classList.contains('is-empty')).toBe(count === 0);
      for (const remote of f.container.querySelectorAll('.remote-grip')) {
        expect(remote.querySelectorAll('.concealed-tile')).toHaveLength(count);
        expect(remote.querySelectorAll('.pips, .hand-tile')).toHaveLength(0);
        expect(remote.classList.contains('is-empty')).toBe(count === 0);
      }
      for (const layer of f.container.querySelectorAll('.grip-layer')) {
        expect(layer).toHaveAttribute('aria-hidden', 'true');
      }
    }
  });
  it('integrates the own hand in the table and draws opponents only from public counts', () => {
    const game = gameFixture();
    game.public.handCounts = [7, 2, 0, 4];
    const { container } = setup(game);
    expect(container.querySelector('.physical-table .hand-panel')).toBeTruthy();
    expect(
      container.querySelectorAll('.scene-player--bottom .concealed-tile'),
    ).toHaveLength(0);
    expect(
      container.querySelectorAll('.scene-player--left .concealed-tile'),
    ).toHaveLength(2);
    expect(
      container.querySelectorAll('.scene-player--top .concealed-tile'),
    ).toHaveLength(0);
    expect(
      container.querySelectorAll('.scene-player--right .concealed-tile'),
    ).toHaveLength(4);
    expect(container.querySelector('.scene-decoration')?.textContent).toBe('');
    expect(container.querySelectorAll('.player-avatar')).toHaveLength(4);
    expect(screen.getAllByLabelText('Change your avatar')).toHaveLength(1);
  });
  it('maps decorative hands to relative seats and only indicates a live public turn', () => {
    const f = setup();
    expect(f.container.querySelectorAll('.remote-grip')).toHaveLength(3);
    expect(f.container.querySelectorAll('.local-grip')).toHaveLength(1);
    expect(f.container.querySelector('.scene-decoration')).toHaveAttribute(
      'aria-hidden',
      'true',
    );
    expect(f.container.querySelector('.scene-player.is-active')).toHaveClass(
      'scene-player--bottom',
    );
    const game = {
      ...f.props.game,
      public: { ...f.props.game.public, turn: 1 as const },
    };
    f.rerender(<GameTable {...f.props} game={game} />);
    expect(f.container.querySelector('.scene-player.is-active')).toHaveClass(
      'scene-player--left',
    );
    f.rerender(
      <GameTable
        {...f.props}
        game={game}
        room={{ ...f.props.room, isPaused: true }}
      />,
    );
    expect(f.container.querySelector('.scene-player.is-active')).toBeNull();
    expect(f.container.querySelector('.held-set.is-active')).toBeNull();
    f.rerender(
      <GameTable {...f.props} game={game} own={{ ...f.props.own, seat: 3 }} />,
    );
    expect(f.container.querySelector('.scene-player.is-active')).toHaveClass(
      'scene-player--top',
    );
  });
  it('renders oriented board pips and doubles without inspecting hands', () => {
    const game = gameFixture();
    game.public.board = [
      { tile: '1:2', left: 2, right: 1 },
      { tile: '1:1', left: 1, right: 1 },
    ];
    game.public.openEnds = { left: 2, right: 1 };
    setup(game);
    const board = screen.getByRole('list', {
      name: 'Played tiles, in chain order',
    });
    expect(within(board).getByLabelText('Played 2:1')).toBeVisible();
    expect(board.querySelectorAll('.double')).toHaveLength(1);
    expect(screen.getByText('Left end · 2')).toBeVisible();
  });
  it('sends the single legal placement on click, with no hover step', () => {
    const f = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Play 1:1' }));
    expect(f.onAction).toHaveBeenCalledWith({
      type: 'play',
      tile: '1:1',
      end: 'start',
    });
    expect(screen.getByRole('button', { name: 'Play 0:0' })).toBeDisabled();
  });
  it('requires explicit left/right choice when both ends are legal', () => {
    const game = gameFixture();
    game.private.legalActions = [
      { type: 'play', tile: '1:2', end: 'left' },
      { type: 'play', tile: '1:2', end: 'right' },
    ];
    const f = setup(game);
    fireEvent.click(screen.getByRole('button', { name: 'Play 1:2' }));
    expect(f.onAction).not.toHaveBeenCalled();
    expect(
      screen.getByRole('group', { name: 'Choose end for 1:2' }),
    ).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Right end →' }));
    expect(f.onAction).toHaveBeenCalledWith({
      type: 'play',
      tile: '1:2',
      end: 'right',
    });
  });
  it('drops an end choice when authoritative revision changes', () => {
    const game = gameFixture();
    game.private.legalActions = [
      { type: 'play', tile: '1:2', end: 'left' },
      { type: 'play', tile: '1:2', end: 'right' },
    ];
    const f = setup(game);
    fireEvent.click(screen.getByRole('button', { name: 'Play 1:2' }));
    f.rerender(<GameTable {...f.props} game={{ ...game, revision: 6 }} />);
    expect(
      screen.queryByRole('group', { name: /Choose end/ }),
    ).not.toBeInTheDocument();
  });
  it('focuses the end choice and returns focus on Escape without submitting', () => {
    const game = gameFixture();
    game.private.legalActions = [
      { type: 'play', tile: '1:2', end: 'left' },
      { type: 'play', tile: '1:2', end: 'right' },
    ];
    const f = setup(game);
    const tile = screen.getByRole('button', { name: 'Play 1:2' });
    fireEvent.click(tile);
    expect(tile).toHaveAttribute('aria-pressed', 'true');
    expect(tile).toHaveAccessibleDescription('Selected');
    const left = screen.getByRole('button', { name: '← Left end' });
    expect(left).toHaveFocus();
    fireEvent.keyDown(left, { key: 'Escape' });
    expect(tile).toHaveFocus();
    expect(tile).toHaveAccessibleDescription('Playable');
    expect(f.onAction).not.toHaveBeenCalled();
  });
  it('disables gameplay while a command is pending', () => {
    setup(gameFixture(), true, true);
    expect(screen.getByRole('button', { name: 'Play 1:1' })).toBeDisabled();
    expect(
      within(screen.getByRole('region', { name: 'Your hand' })).getByRole(
        'status',
      ),
    ).toHaveTextContent('Sending move…');
    expect(screen.getByRole('region', { name: 'Your hand' })).toHaveAttribute(
      'aria-busy',
      'true',
    );
  });
  it('offers pass only when the server includes pass', () => {
    const game = gameFixture();
    game.private.legalActions = [{ type: 'pass' }];
    const f = setup(game);
    fireEvent.click(screen.getByRole('button', { name: 'Pass' }));
    expect(f.onAction).toHaveBeenCalledWith({ type: 'pass' });
  });
  it('does not invent pass when no actions are available', () => {
    const game = gameFixture();
    game.private.legalActions = [];
    game.public.turn = 1;
    setup(game);
    expect(
      screen.queryByRole('button', { name: /Pass/ }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Murad’s turn' })).toBeVisible();
  });
  it('shows both eligible partners and submits the selected starter', () => {
    const game = gameFixture();
    game.public.phase = 'starter-selection';
    game.public.eligibleTeam = 'A';
    game.public.turn = null;
    game.public.starter = null;
    game.private.legalActions = [
      { type: 'select-starter', selected: 0 },
      { type: 'select-starter', selected: 2 },
    ];
    const f = setup(game);
    fireEvent.click(screen.getByRole('button', { name: 'Let Leyla start' }));
    expect(f.onAction).toHaveBeenCalledWith({
      type: 'select-starter',
      selected: 2,
    });
    expect(screen.getByText(/Ayla & Leyla/)).toBeVisible();
  });
  it('shows locked starter and official scoring without computing totals', () => {
    const game = gameFixture();
    game.public.score.teams.A = {
      officialScore: 42,
      pendingOpeningPoints: 0,
      isScoreOpened: true,
    };
    game.public.score.teams.B.pendingOpeningPoints = 27;
    game.public.score.sekaBank = 50;
    setup(game);
    expect(screen.getByText('42')).toBeVisible();
    expect(screen.getByText('Opened · Pending 0')).toBeVisible();
    expect(screen.getByText('Unopened · Pending 27')).toBeVisible();
    expect(screen.getByText(/SEKA bank · 50/)).toBeVisible();
    expect(screen.getByText('Starter locked · Ayla')).toBeVisible();
  });
  it.each(['normal', 'baglanma', 'seka'] as const)(
    'shows %s round result',
    (kind) => {
      const game = gameFixture();
      game.public.phase = 'round-ended';
      game.public.turn = null;
      game.public.result =
        kind === 'seka'
          ? { kind, remainingPoints: { A: 25, B: 25 } }
          : {
              kind,
              winner: 'A',
              normalPoints: 25,
              remainingPoints: { A: 0, B: 25 },
            };
      game.public.awardedPoints = kind === 'seka' ? 0 : 25;
      game.private.legalActions = [{ type: 'next-round' }];
      const f = setup(game);
      expect(
        screen.getByRole('region', { name: 'Round result' }),
      ).toHaveTextContent('Remaining points');
      fireEvent.click(screen.getByRole('button', { name: 'Start next round' }));
      expect(f.onAction).toHaveBeenCalledWith({ type: 'next-round' });
    },
  );
  it('shows match victory without rematch actions', () => {
    const game: GameSnapshot = gameFixture();
    game.public.phase = 'match-finished';
    game.public.winner = 'B';
    game.public.turn = null;
    game.public.result = {
      kind: 'normal',
      winner: 'B',
      normalPoints: 26,
      remainingPoints: { A: 26, B: 0 },
    };
    game.private.legalActions = [];
    setup(game);
    expect(screen.getByRole('heading', { name: 'Team B wins!' })).toBeVisible();
    expect(
      screen.queryByRole('button', { name: 'Start next round' }),
    ).not.toBeInTheDocument();
  });
});
