/**
 * 胜率计算器
 * 使用 Monte Carlo 模拟计算胜率
 */

import { Card, Meld, WinRateCalculation } from '../shared/types';
import { CardFactory } from '../shared/types/card';
import { MeldDetector } from '../game-engine/meld-detector';
import { ScoreCalculator } from '../game-engine/score-calculator';
import { RulesValidator } from '../game-engine/rules-validator';
import { SimulationResult } from './types';

/**
 * 胜率计算器类
 */
export class WinRateCalculator {
  private meldDetector: MeldDetector;
  private scoreCalculator: ScoreCalculator;
  private rulesValidator: RulesValidator;

  constructor() {
    this.meldDetector = new MeldDetector();
    this.scoreCalculator = new ScoreCalculator();
    this.rulesValidator = new RulesValidator();
  }

  /**
   * 计算当前胜率
   */
  calculateWinRate(
    handCards: Card[],
    melds: Meld[],
    knownCards: Set<string>,
    simulationCount: number = 1000
  ): WinRateCalculation {
    const potentialWinRates = new Map<string, number>();
    let totalWins = 0;

    const possibleDraws = this.getPossibleDraws(knownCards);

    for (const drawCard of possibleDraws) {
      let wins = 0;

      for (let i = 0; i < simulationCount / possibleDraws.length; i++) {
        const result = this.simulateDraw(handCards, melds, drawCard, knownCards);
        if (result.win) {
          wins++;
          totalWins++;
        }
      }

      const winRate = wins / (simulationCount / possibleDraws.length);
      potentialWinRates.set(drawCard.id, winRate);
    }

    const averageWinRate = totalWins / simulationCount;

    return {
      currentWinRate: averageWinRate,
      potentialWinRates,
      averageWinRate,
      calculationMethod: 'monte_carlo',
      simulationCount
    };
  }

  private getPossibleDraws(knownCards: Set<string>): Card[] {
    const fullDeck = CardFactory.createDeck();
    return fullDeck.filter(card => !knownCards.has(card.id));
  }

  private simulateDraw(
    handCards: Card[],
    melds: Meld[],
    drawCard: Card,
    _knownCards: Set<string>
  ): SimulationResult {
    const newHand = [...handCards, drawCard];
    const newMelds = [...melds];
    const remainingCards = [...newHand];

    const pairs = this.meldDetector.detectPairs(remainingCards);
    newMelds.push(...pairs.melds);

    const triples = this.meldDetector.detectTriples(remainingCards);
    newMelds.push(...triples.melds);

    const sequences = this.meldDetector.detectSequences(remainingCards);
    newMelds.push(...sequences.melds);

    const special2710 = this.meldDetector.detectSpecial2710(remainingCards);
    newMelds.push(...special2710.melds);

    const { totalHuPoints } = this.scoreCalculator.calculateTotalScore(newMelds);

    const canWin = this.rulesValidator.checkCanWin(
      remainingCards,
      newMelds,
      totalHuPoints
    );

    return {
      win: canWin,
      score: totalHuPoints,
      turns: 0
    };
  }

  calculateHeuristicWinRate(
    handCards: Card[],
    melds: Meld[]
  ): WinRateCalculation {
    const potentialMelds = this.meldDetector.detectAllMelds(handCards);
    const scoreSnapshot = this.scoreCalculator.calculateTotalScore([...melds, ...potentialMelds]);
    const pairCount = this.meldDetector.detectPairs(handCards).melds.length;
    const tripleCount = this.meldDetector.detectTriples(handCards).melds.length;
    const sequenceCount = this.meldDetector.detectSequences(handCards).melds.length;
    const specialCount = this.meldDetector.detectSpecial2710(handCards).melds.length;
    const usedCards = potentialMelds.reduce((sum, meld) => sum + meld.cards.length, 0);
    const looseCards = Math.max(0, handCards.length - usedCards);
    const redCards = handCards.filter(c => c.isRed).length;

    let winRate = 0.08;
    winRate += melds.length * 0.09;
    winRate += potentialMelds.filter((meld) => meld.type !== 'pair').length * 0.05;
    winRate += pairCount * 0.025;
    winRate += tripleCount * 0.05;
    winRate += sequenceCount * 0.03;
    winRate += specialCount * 0.03;
    winRate += Math.min(0.18, scoreSnapshot.totalHuPoints * 0.01);
    winRate += Math.min(0.12, scoreSnapshot.roundScore * 0.012);
    winRate += redCards * 0.008;
    winRate -= looseCards * 0.022;

    if (this.rulesValidator.canHu(handCards, melds)) {
      winRate = Math.max(winRate, 0.96);
    }

    return {
      currentWinRate: Math.max(0, Math.min(1, winRate)),
      potentialWinRates: new Map(),
      averageWinRate: Math.max(0, Math.min(1, winRate)),
      calculationMethod: 'heuristic'
    };
  }

  calculateDiscardWinRates(
    handCards: Card[],
    melds: Meld[],
    _knownCards: Set<string>
  ): Map<string, number> {
    const winRates = new Map<string, number>();

    for (const card of handCards) {
      const remainingCards = handCards.filter(c => c.id !== card.id);
      const result = this.calculateHeuristicWinRate(remainingCards, melds);
      winRates.set(card.id, result.currentWinRate);
    }

    return winRates;
  }
}
