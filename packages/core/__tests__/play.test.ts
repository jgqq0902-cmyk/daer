import { describe, it, expect } from 'vitest';
import { MeldDetector } from "../src/game-engine/meld-detector";
import { RulesValidator } from "../src/game-engine/rules-validator";
import { ScoreCalculator } from "../src/game-engine/score-calculator";
import { Card, CardSuit, CardSize, MeldType } from "../src/shared/types";

describe('rules bug debug', () => {
  it('debug hu', () => {
    const meldDetector = new MeldDetector();
    const scoreCalc = new ScoreCalculator();
    const rulesValidator = new RulesValidator(meldDetector, scoreCalc);

    function c(rank: any, size: CardSize, id: string): Card {
      return { id, rank, value: rank, size };
    }

    const huHand = [
      c(2, CardSize.BIG, "1"),
      c(4, CardSize.BIG, "2"),
      c(4, CardSize.BIG, "3"),
      c(7, CardSize.BIG, "4"),
      c(10, CardSize.BIG, "5")
    ];
    const s4 = c(4, CardSize.SMALL, "s4");

    const rootMelds = [
      { type: MeldType.SEQUENCE, cards: [c(4, CardSize.SMALL, "a"), c(5, CardSize.SMALL, "b"), c(6, CardSize.SMALL, "c")], position: "table" as const, isConcealed: false, huPoints: 0 },
      { type: MeldType.SEQUENCE, cards: [c(4, CardSize.SMALL, "a1"), c(5, CardSize.SMALL, "b1"), c(6, CardSize.SMALL, "c1")], position: "table" as const, isConcealed: false, huPoints: 0 },
      { type: MeldType.SEQUENCE, cards: [c(4, CardSize.SMALL, "a2"), c(5, CardSize.SMALL, "b2"), c(6, CardSize.SMALL, "c2")], position: "table" as const, isConcealed: false, huPoints: 0 },
      { type: MeldType.SEQUENCE, cards: [c(4, CardSize.SMALL, "a3"), c(5, CardSize.SMALL, "b3"), c(6, CardSize.SMALL, "c3")], position: "table" as const, isConcealed: false, huPoints: 0 },
      { type: MeldType.SEQUENCE, cards: [c(4, CardSize.SMALL, "a4"), c(5, CardSize.SMALL, "b4"), c(6, CardSize.SMALL, "c4")], position: "table" as const, isConcealed: false, huPoints: 0 },
    ];

    const meldsRef = rulesValidator.findWinningHandMelds([...huHand, s4], rootMelds);
    expect(meldsRef).toBeDefined();
    expect((meldsRef || []).length).toBeGreaterThan(0);

    const result = rulesValidator.canHu(huHand, rootMelds, s4);
    expect(result).toBe(true);
    if (meldsRef) {
      const score = scoreCalc.calculateTotalScore([...rootMelds, ...meldsRef]);
      expect(score.finalScore).toBeGreaterThanOrEqual(0);
    }
  });

  it('debug chi', () => {
    const meldDetector = new MeldDetector();
    const scoreCalc = new ScoreCalculator();
    const rulesValidator = new RulesValidator(meldDetector, scoreCalc);

    function c(rank: any, size: CardSize, id: string): Card {
      return { id, rank, value: rank, size };
    }

    const chiHand = [
      c(6, CardSize.SMALL, "1"),
      c(6, CardSize.BIG, "2"),
      c(8, CardSize.BIG, "3"),
      c(9, CardSize.SMALL, "4"),
      c(9, CardSize.BIG, "5"),
      c(6, CardSize.BIG, "6"),
      c(8, CardSize.SMALL, "7")
    ];
    const s4 = c(4, CardSize.SMALL, "s4");
    const b7 = c(7, CardSize.BIG, "b7");

    expect(rulesValidator.canChi(chiHand, s4)).toBe(false);
    expect(rulesValidator.canChi(chiHand, b7)).toBe(true);
  });
});
