import { describe, expect, it } from 'vitest';
import { RulesValidator } from '../src/game-engine/rules-validator';
import { CardFactory } from '../src/shared/types/card';
import { CardSize, MeldType } from '../src/shared/types';

function sameCards(count: number) {
  return Array.from({ length: count }, () => CardFactory.create('三', CardSize.SMALL));
}

describe('meld 基础张数契约', () => {
  const validator = new RulesValidator();

  it.each([MeldType.PENG, MeldType.TRIPLE])('%s requires exactly three cards', (type) => {
    expect(validator.isValidMeld(sameCards(2), type)).toBe(false);
    expect(validator.isValidMeld(sameCards(3), type)).toBe(true);
    expect(validator.isValidMeld(sameCards(4), type)).toBe(false);
    expect(validator.isValidMeld(sameCards(5), type)).toBe(false);
  });

  it.each([MeldType.QUADRUPLE, MeldType.DRAW_QUADRUPLE])('%s requires exactly four cards', (type) => {
    expect(validator.isValidMeld(sameCards(2), type)).toBe(false);
    expect(validator.isValidMeld(sameCards(3), type)).toBe(false);
    expect(validator.isValidMeld(sameCards(4), type)).toBe(true);
    expect(validator.isValidMeld(sameCards(5), type)).toBe(false);
  });
});
