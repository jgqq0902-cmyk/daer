import type { GameState, PlayerAction } from '../shared/types';

/**
 * The Bridge accepts only actions advertised by the current core snapshot.
 * UI and policies can choose a candidate, but cannot extend the rule surface.
 */
export function isLegalGodotAction(currentState: GameState, action: PlayerAction): boolean {
  const actingPlayerIndex = currentState.phase === 'response_collecting' && typeof currentState.responseWindow?.currentResponderIndex === 'number'
    ? currentState.responseWindow.currentResponderIndex
    : currentState.currentPlayerIndex;
  const currentPlayer = currentState.players[actingPlayerIndex];
  if (!currentPlayer || action.playerId !== currentPlayer.playerId) return false;
  const offered = findOfferedAction(currentState, action);
  if (!offered) return false;
  if (action.type === 'chi') {
    return !!action.chiOptionId && (offered.chiOptions || []).some(option => option.id === action.chiOptionId);
  }
  if (action.type === 'hu' && (offered.huOptions || []).length > 0) {
    return !!action.huOptionId && offered.huOptions!.some(option => option.id === action.huOptionId);
  }
  return true;
}

function findOfferedAction(currentState: GameState, action: PlayerAction) {
  if (action.type === 'discard') {
    const cardId = action.cards?.[0]?.id;
    return cardId
      ? currentState.availableActions.find(candidate => candidate.type === 'discard' && candidate.cards.some(card => card.id === cardId))
      : undefined;
  }
  if (action.type === 'bao' && action.cards?.length) {
    const selectedCardId = action.cards[0]?.id;
    return selectedCardId
      ? currentState.availableActions.find(candidate => candidate.type === 'bao' && candidate.cards.some(card => card.id === selectedCardId))
      : undefined;
  }
  const offered = currentState.availableActions.find(candidate => candidate.type === action.type);
  return offered;
}

/**
 * Rebuild an accepted Bridge action from the current core snapshot.
 * This keeps recorded actions identical to the cards core will execute.
 */
export function normalizeGodotAction(currentState: GameState, action: PlayerAction): PlayerAction | null {
  if (!isLegalGodotAction(currentState, action)) return null;

  const offered = findOfferedAction(currentState, action)!;
  // Never retain card data supplied by a client. The offered action is the
  // canonical representation for every action type unless an option refines it.
  const normalized: PlayerAction = { ...action, cards: offered.cards };
  if (action.type === 'discard') {
    normalized.cards = [offered.cards.find(card => card.id === action.cards?.[0]?.id)!];
  } else if (action.type === 'chi') {
    const option = offered.chiOptions!.find(item => item.id === action.chiOptionId)!;
    normalized.cards = option.selectedCards;
    normalized.chiOptionId = option.id;
  } else if (action.type === 'hu' && offered.huOptions?.length) {
    const option = offered.huOptions.find(item => item.id === action.huOptionId)!;
    normalized.cards = option.selectedCards.length ? option.selectedCards : offered.cards;
    normalized.huOptionId = option.id;
  }
  return normalized;
}
