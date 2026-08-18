import type { Card, GameState, PlayerHand } from '../shared/types';

export type ClaimType = 'chi' | 'hu' | 'peng' | 'zhao';

/** 过张身份只比较牌面等级和大小写，不比较牌的实例 id。 */
export function sameCardIdentity(left: Card, right: Card): boolean {
  return left.rank === right.rank && left.size === right.size;
}

/**
 * 判断玩家是否已经对同一张牌面形成过张。
 * 只有主动出牌和放弃合法吃牌会形成永久过张记录。
 */
export function hasPassedCard(player: Pick<PlayerHand, 'passedPlays'>, card: Card): boolean {
  return player.passedPlays.some((passedPlay) => (
    (passedPlay.actionType === 'discard' || passedPlay.actionType === 'chi') &&
    sameCardIdentity(passedPlay.card, card)
  ));
}

/**
 * 统一校验当前牌是否仍可被玩家吃/胡。
 * 碰、招不受吃牌过张规则影响；保留 claimType 以便调用方明确表达动作。
 */
export function canClaimActiveCard(
  state: GameState,
  playerIndex: number,
  card: Card,
  claimType: ClaimType,
): { allowed: boolean; reason?: string } {
  const player = state.players[playerIndex];
  if (!player) {
    return { allowed: false, reason: '玩家不存在' };
  }

  if ((claimType === 'chi' || claimType === 'hu') && hasPassedCard(player, card)) {
    return { allowed: false, reason: '已过张，不能再吃或胡此牌' };
  }

  return { allowed: true };
}
