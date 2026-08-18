import type { GameState } from '../shared/types';

export type OpeningPhase = 'bao_selection' | 'dealer_pending_resolution' | 'normal';

export interface OpeningMingTangContext {
  dealerIndex: number;
  winnerIndex: number;
  openingPhase: OpeningPhase;
  ordinaryActionCount: number;
  drawOrdinal: number;
  source?: 'discard' | 'draw';
  sourcePlayerIndex?: number;
}

/**
 * 天胡只能由庄家在未发生普通动作、未发生真实翻山牌的开局窗口声明。
 * dealer_pending_resolution 包含庄家独立的第21张待处理牌，但不把它算作翻山。
 */
export function canDeclareHeavenlyWin(context: OpeningMingTangContext): boolean {
  return context.winnerIndex === context.dealerIndex
    && (context.openingPhase === 'bao_selection' || context.openingPhase === 'dealer_pending_resolution')
    && context.ordinaryActionCount === 0
    && context.drawOrdinal === 0;
}

/** 水上漂只认第一次真实从牌山翻出的牌，不能由 turnCount 推导。 */
export function isFirstMountainFlipWin(
  context: Pick<OpeningMingTangContext, 'source' | 'sourcePlayerIndex' | 'winnerIndex'>,
  drawOrdinal: number,
): boolean {
  return context.source === 'draw'
    && context.sourcePlayerIndex === context.winnerIndex
    && drawOrdinal === 1;
}

export function openingMingTangContext(state: GameState, winnerIndex: number): OpeningMingTangContext {
  const dealerIndex = state.players.findIndex((player) => player.isDealer);
  return {
    dealerIndex,
    winnerIndex,
    openingPhase: state.openingPhase || 'normal',
    ordinaryActionCount: state.openingFacts?.ordinaryActionCount || 0,
    drawOrdinal: state.drawOrdinal || 0,
    source: state.pendingCardSource,
    sourcePlayerIndex: state.discardPile.lastDiscardPlayerIndex,
  };
}
