import { useI18n } from '../i18n';
import { useEffect, useRef, useState } from 'react';
import type {
  GameAction,
  GameSnapshot,
  RoomJoined,
  RoomSnapshot,
} from '@domino/protocol';
import { Domino } from './Domino';
import { DominoChain } from './DominoChain';
import { Seats } from './Seats';
import { tableStatus } from './tableStatus';
import { TableScene } from './TableScene';
import { HeldTiles } from './HeldTiles';

interface Props {
  room: RoomSnapshot;
  own: RoomJoined;
  game: GameSnapshot;
  disabled: boolean;
  pending: boolean;
  onAction: (action: GameAction) => Promise<boolean>;
}
export function GameTable({
  room,
  own,
  game,
  disabled,
  pending,
  onAction,
}: Props) {
  const { t } = useI18n();
  const state = game.public;
  const [choice, setChoice] = useState<{
    tile: string;
    revision: number;
  } | null>(null);
  const actions = game.private.legalActions;
  const chosen = choice?.revision === game.revision ? choice.tile : null;
  const ends = actions.filter(
    (action) => action.type === 'play' && action.tile === chosen,
  );
  const play = (action: GameAction) => {
    setChoice(null);
    void onAction(action);
  };
  const status = tableStatus(room, own, game, t);
  const choicePanel = useRef<HTMLDivElement>(null);
  const selectedButton = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (chosen && !disabled)
      choicePanel.current?.querySelector('button')?.focus();
  }, [chosen, disabled]);
  function cancelChoice() {
    setChoice(null);
    selectedButton.current?.focus();
  }
  return (
    <div className="game" data-revision={game.revision}>
      <section className="scoreboard" aria-label={t('game.scores')}>
        {(['A', 'B'] as const).map((team) => {
          const score = state.score.teams[team];
          return (
            <div key={team} className="team-score">
              <div>
                <span className="eyebrow score-team-label">
                  {t('seat.team', { team })}
                  {room.seats[own.seat]?.team === team
                    ? ` · ${t('game.yourTeam')}`
                    : ''}
                </span>
                <span className="mobile-score-team" aria-hidden="true">
                  {team}
                  {room.seats[own.seat]?.team === team ? ' •' : ''}
                </span>
                <span>
                  {t('game.pendingPoints', {
                    state: t(
                      score.isScoreOpened ? 'game.opened' : 'game.unopened',
                    ),
                    points: score.pendingOpeningPoints,
                  })}
                </span>
              </div>
              <strong>{score.officialScore}</strong>
            </div>
          );
        })}
        <div className="round-info">
          {t('game.round', { number: state.roundNumber })}
          <span>{t('game.target')}</span>
        </div>
      </section>
      {(!state.score.teams.A.isScoreOpened ||
        !state.score.teams.B.isScoreOpened) && (
        <p className="score-help">{t('game.scoreHelp')}</p>
      )}
      {state.score.sekaBank > 0 && (
        <p className="seka">
          {t('game.sekaBank', { points: state.score.sekaBank })}
        </p>
      )}
      <TableScene room={room} own={own} game={game}>
        <Seats room={room} own={own} game={game} />
        <section className="board-zone" aria-label={t('game.table')}>
          <p className="eyebrow">BAKI · DOMINO 101</p>
          <h2 className="turn-label">{status}</h2>
          {state.openEnds && (
            <div className="open-ends">
              <span>{t('game.left', { value: state.openEnds.left })}</span>
              <span>{t('game.right', { value: state.openEnds.right })}</span>
            </div>
          )}
          <DominoChain
            board={state.board}
            motionScope={`${game.matchId}:${state.roundNumber}`}
            motionEnabled={!room.isPaused}
          />
          {state.board.length === 0 && (
            <p className="empty-board">
              {state.phase === 'starter-selection'
                ? t('game.emptySelection')
                : t('game.emptyBoard')}
            </p>
          )}
          {state.starter !== null && (
            <p className="starter-note">
              {t('game.starterLocked', {
                name: room.seats[state.starter]?.displayName ?? '',
              })}
            </p>
          )}
        </section>
        <section
          aria-busy={pending}
          className={`hand-panel ${pending ? 'pending-move' : ''}`}
          aria-label={t('game.hand')}
        >
          <div className="hand-heading">
            <h3>
              {t('game.tiles')}
              <span>{game.private.hand.length}</span>
            </h3>
            <span role="status">
              {pending
                ? t('game.sending')
                : disabled
                  ? t('game.unavailable')
                  : state.turn === own.seat
                    ? t('game.chooseTile')
                    : state.phase === 'match-finished'
                      ? t('game.matchComplete')
                      : state.phase === 'round-ended'
                        ? t('game.roundComplete')
                        : state.phase === 'starter-selection'
                          ? t('game.choosingStarter')
                          : t('game.waitTurn')}
            </span>
          </div>
          {actions.some((action) => action.type === 'pass') && (
            <div className="hand-controls">
              <button
                disabled={disabled}
                onClick={() => play({ type: 'pass' })}
              >
                {t('game.pass')}
              </button>
            </div>
          )}
          <HeldTiles
            count={game.private.hand.length}
            active={
              !room.isPaused &&
              state.phase === 'playing' &&
              state.turn === own.seat
            }
          >
            <div className="hand">
              {game.private.hand.map((tile, index) => {
                const moves = actions.filter(
                  (action) => action.type === 'play' && action.tile === tile,
                );
                const [left, right] = tile.split(':').map(Number);
                return (
                  <button
                    className={`hand-tile ${moves.length && !disabled ? 'playable' : ''}`}
                    key={tile}
                    style={{
                      rotate: `${(index - (game.private.hand.length - 1) / 2) * 3}deg`,
                      translate: `0 ${Math.abs(index - (game.private.hand.length - 1) / 2) * 1.5}px`,
                    }}
                    aria-label={t('game.playTile', { tile })}
                    aria-describedby={`tile-state-${tile.replace(':', '-')}`}
                    aria-pressed={chosen === tile}
                    disabled={disabled || moves.length === 0}
                    onClick={(event) => {
                      selectedButton.current = event.currentTarget;
                      if (moves.length === 1) play(moves[0]!);
                      else setChoice({ tile, revision: game.revision });
                    }}
                  >
                    <Domino left={left!} right={right!} />
                    <span className="tile-indicator" aria-hidden="true">
                      {chosen === tile
                        ? '✓'
                        : !disabled && moves.length
                          ? '•'
                          : '−'}
                    </span>
                    <span
                      className="sr-only"
                      id={`tile-state-${tile.replace(':', '-')}`}
                    >
                      {t(
                        pending
                          ? 'game.sending'
                          : chosen === tile
                            ? 'game.tileSelected'
                            : !disabled && moves.length
                              ? 'game.tilePlayable'
                              : 'game.tileUnavailable',
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
          </HeldTiles>
          {chosen && !disabled && (
            <div
              className="end-choice"
              ref={choicePanel}
              onKeyDown={(event) => {
                if (event.key === 'Escape') cancelChoice();
              }}
              role="group"
              aria-label={t('game.chooseEnd', { tile: chosen })}
            >
              <strong>{t('game.placeOn', { tile: chosen })}</strong>
              {ends.map(
                (action) =>
                  action.type === 'play' && (
                    <button key={action.end} onClick={() => play(action)}>
                      {action.end === 'left'
                        ? t('game.leftButton')
                        : t('game.rightButton')}
                    </button>
                  ),
              )}
              <button className="quiet" onClick={cancelChoice}>
                {t('game.cancel')}
              </button>
            </div>
          )}
        </section>
      </TableScene>
      {state.phase === 'starter-selection' && (
        <section className="action-panel" aria-label={t('game.starterRegion')}>
          <h3>{t('game.whoStarts')}</h3>
          <p>
            {t('game.starterHelp', {
              team: state.eligibleTeam ?? '',
              names: room.seats
                .filter((player) => player?.team === state.eligibleTeam)
                .map((player) => player?.displayName)
                .join(' & '),
            })}
          </p>
          <div className="button-row">
            {actions
              .filter((action) => action.type === 'select-starter')
              .map((action) => (
                <button
                  key={action.selected}
                  disabled={disabled}
                  onClick={() => play(action)}
                >
                  {t('game.letStart', {
                    name:
                      room.seats[action.selected ?? own.seat]?.displayName ??
                      '',
                  })}
                </button>
              ))}
          </div>
          {!actions.some((action) => action.type === 'select-starter') && (
            <p>{t('game.waitStarter')}</p>
          )}
        </section>
      )}
      {state.result && (
        <section
          className="action-panel result-panel"
          aria-label={t('game.resultRegion')}
        >
          <h3>
            {state.winner
              ? t('game.victory', { team: state.winner })
              : state.result.kind === 'seka'
                ? t('game.sekaResult')
                : t('game.roundWinner', { team: state.result.winner })}
          </h3>
          <p>
            {state.result.kind === 'normal'
              ? t('game.normalResult')
              : state.result.kind === 'baglanma'
                ? t('game.blockedResult')
                : t('game.tiedResult')}{' '}
            {state.awardedPoints !== null &&
              t('game.award', { points: state.awardedPoints })}
          </p>
          <p>
            {t('game.remaining', {
              a: state.result.remainingPoints.A,
              b: state.result.remainingPoints.B,
            })}
          </p>
          {actions.some((action) => action.type === 'next-round') && (
            <button
              disabled={disabled}
              onClick={() => play({ type: 'next-round' })}
            >
              {t('game.nextRound')}
            </button>
          )}
          {state.phase === 'round-ended' && room.hostId !== own.playerId && (
            <p>{t('game.waitHost')}</p>
          )}
          {state.winner && <p>{t('game.finishedHelp')}</p>}
        </section>
      )}
    </div>
  );
}
