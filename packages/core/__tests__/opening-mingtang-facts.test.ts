import { describe, expect, it } from 'vitest';
import { canDeclareHeavenlyWin, isFirstMountainFlipWin } from '../src/game-engine/opening-facts';

const baseContext = {
  dealerIndex: 0,
  winnerIndex: 0,
  openingPhase: 'dealer_pending_resolution' as const,
  ordinaryActionCount: 0,
  drawOrdinal: 0,
  source: 'draw' as const,
  sourcePlayerIndex: 0,
};

describe('开局名堂显式事实', () => {
  it('MING-001 rejects a non-dealer even when turnCount would be zero', () => {
    expect(canDeclareHeavenlyWin({ ...baseContext, winnerIndex: 1 })).toBe(false);
  });

  it('MING-002 accepts the dealer during untouched opening resolution', () => {
    expect(canDeclareHeavenlyWin(baseContext)).toBe(true);
  });

  it('MING-003 identifies the first real mountain flip', () => {
    expect(isFirstMountainFlipWin(baseContext, 1)).toBe(true);
  });

  it('MING-004 does not infer first-flip ming tang from turn count', () => {
    expect(isFirstMountainFlipWin({ ...baseContext, drawOrdinal: 2 }, 2)).toBe(false);
    expect(isFirstMountainFlipWin({ ...baseContext, drawOrdinal: 0 }, 0)).toBe(false);
  });
});
