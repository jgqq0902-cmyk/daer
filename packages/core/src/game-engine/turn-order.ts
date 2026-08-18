/**
 * Seat order used by the three-player game.
 *
 * The player indexes are stable identifiers, while the turn direction is
 * counter-clockwise: player 0 -> player 2 -> player 1 -> player 0.
 */
export const THREE_PLAYER_TURN_ORDER = [0, 2, 1] as const;

export function getTurnOrder(playerCount: number): number[] {
  if (playerCount !== THREE_PLAYER_TURN_ORDER.length) {
    throw new Error('Only three-player turn order is supported.');
  }
  return [...THREE_PLAYER_TURN_ORDER];
}

function getSeatPosition(playerIndex: number, playerCount: number): number {
  const position = getTurnOrder(playerCount).indexOf(playerIndex);
  return position >= 0 ? position : playerIndex;
}

export function getNextPlayerIndex(playerIndex: number, playerCount: number): number {
  const order = getTurnOrder(playerCount);
  if (order.length === 0) return playerIndex;

  const position = getSeatPosition(playerIndex, playerCount);
  return order[(position + 1) % order.length];
}

export function getPreviousPlayerIndex(playerIndex: number, playerCount: number): number {
  const order = getTurnOrder(playerCount);
  if (order.length === 0) return playerIndex;

  const position = getSeatPosition(playerIndex, playerCount);
  return order[(position - 1 + order.length) % order.length];
}

export function getTurnDistance(
  fromPlayerIndex: number,
  toPlayerIndex: number,
  playerCount: number,
): number {
  const order = getTurnOrder(playerCount);
  if (order.length === 0) return 0;

  const fromPosition = getSeatPosition(fromPlayerIndex, playerCount);
  const toPosition = getSeatPosition(toPlayerIndex, playerCount);
  return (toPosition - fromPosition + order.length) % order.length;
}

export function getResponderOrder(
  source: 'discard' | 'draw',
  sourcePlayerIndex: number,
  playerCount: number,
): number[] {
  const order = getTurnOrder(playerCount);
  if (order.length === 0) return [];

  const sourcePosition = getSeatPosition(sourcePlayerIndex, playerCount);
  const firstOffset = source === 'draw' ? 0 : 1;
  const responderCount = source === 'draw' ? order.length : Math.max(0, order.length - 1);

  return Array.from({ length: responderCount }, (_, offset) =>
    order[(sourcePosition + firstOffset + offset) % order.length],
  );
}
