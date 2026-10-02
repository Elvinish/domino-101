import { createMatch } from '@domino/game-engine';
import type { MatchState, RoundEndedState } from '@domino/game-engine';
import {
  applyBotCommand,
  chooseCommand,
  getBotView,
  shuffleDeck,
} from '../index.js';

export function firstRound(seed = 0): RoundEndedState {
  let state: MatchState = createMatch(shuffleDeck(seed).deck);
  for (let index = 0; state.phase === 'playing' && index < 100; index++) {
    const command = chooseCommand(
      getBotView(state, state.turn),
      'deterministic-first',
      0,
    ).command;
    if (!command) throw new Error('Missing fixture action');
    state = applyBotCommand(state, command);
  }
  if (state.phase !== 'round-ended' || state.result.kind === 'seka')
    throw new Error('Expected a non-SEKA completed round');
  return state;
}
