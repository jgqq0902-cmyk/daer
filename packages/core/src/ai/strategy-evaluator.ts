/**
 * 策略评估器
 * 评估当前局势和出牌策略
 */

import { Card, Meld, StrategyEvaluation, StrategyFactor, HandStrength } from '../shared/types';
import { HandAnalyzer } from '../game-engine/hand-analyzer';
import { ScoreCalculator } from '../game-engine/score-calculator';
import { WinRateCalculator } from './win-rate-calculator';

/**
 * 策略评估器类
 */
export class StrategyEvaluator {
  private handAnalyzer: HandAnalyzer;
  private scoreCalculator: ScoreCalculator;
  private winRateCalculator: WinRateCalculator;

  constructor() {
    this.handAnalyzer = new HandAnalyzer();
    this.scoreCalculator = new ScoreCalculator();
    this.winRateCalculator = new WinRateCalculator();
  }

  /**
   * 评估当前手牌策略
   */
  evaluate(
    handCards: Card[],
    melds: Meld[],
    discardedCards: Card[]
  ): StrategyEvaluation {
    const handStrength = this.getHandStrengthLevel(handCards, melds);
    const analysis = this.handAnalyzer.analyze(handCards, melds);
    const scoreSnapshot = this.scoreCalculator.calculateTotalScore([...melds, ...analysis.potentialMelds]);
    const estimatedWinRate = this.winRateCalculator.calculateHeuristicWinRate(handCards, melds).currentWinRate;
    const position = this.evaluatePosition(handCards, melds, discardedCards, analysis, scoreSnapshot.totalHuPoints, estimatedWinRate);
    const keyFactors = this.identifyKeyFactors(handCards, melds, discardedCards, analysis, scoreSnapshot.totalHuPoints, estimatedWinRate, scoreSnapshot.roundScore, scoreSnapshot.totalFans);
    const riskLevel = this.assessRisk(handCards, melds, discardedCards, analysis);
    const overallScore = this.calculateOverallScore(keyFactors);

    return {
      handStrength,
      position,
      keyFactors,
      riskLevel,
      overallScore,
      suggestions: this.generateSuggestions(handStrength, keyFactors, riskLevel, analysis.stepsToWin || 0, scoreSnapshot.totalHuPoints, scoreSnapshot.roundScore)
    };
  }

  /**
   * 评估持牌质量
   */
  private evaluatePosition(
    handCards: Card[],
    melds: Meld[],
    discardedCards: Card[],
    analysis: ReturnType<HandAnalyzer['analyze']>,
    totalHuPoints: number,
    estimatedWinRate: number,
  ): number {
    let score = 40;

    score += Math.min(30, totalHuPoints * 3.5);
    score += Math.min(18, analysis.tingCards.length * 2.5);
    score += (analysis.completeness || 0) * 18;
    score += estimatedWinRate * 16;

    const redCards = handCards.filter((card) => card.isRed).length;
    score += Math.min(8, redCards * 1.8);

    const meldCount = melds.filter((meld) => meld.type !== 'pair').length;
    score += Math.min(10, meldCount * 2.5);

    if (analysis.canWin) {
      score += 18;
    } else if ((analysis.stepsToWin || 3) <= 1) {
      score += 10;
    }

    return Math.min(100, Math.max(0, score));
  }

  /**
   * 识别关键因素
   */
  private identifyKeyFactors(
    handCards: Card[],
    melds: Meld[],
    discardedCards: Card[],
    analysis: ReturnType<HandAnalyzer['analyze']>,
    totalHuPoints: number,
    estimatedWinRate: number,
    roundScore: number,
    totalFans: number,
  ): StrategyFactor[] {
    const factors: StrategyFactor[] = [];
    const redCount = handCards.filter((card) => card.isRed).length;
    const meldCount = melds.filter((meld) => meld.type !== 'pair').length;
    const scoringPressure = Math.min(1, (totalHuPoints * 0.5 + roundScore * 0.8 + totalFans * 2) / 24);
    const attackPressure = analysis.canWin
      ? 1
      : Math.max(0, 1 - ((analysis.stepsToWin || 4) - 1) / 4);
    const defensePressure = Math.min(1, ((analysis.looseCards.length || 0) / Math.max(1, handCards.length)) + (discardedCards.length > 10 ? 0.15 : 0));
    const flexibility = Math.min(1, ((analysis.potentialMelds.length - analysis.looseCards.length * 0.35) + analysis.tingCards.length) / Math.max(3, handCards.length * 0.55));

    factors.push({
      name: '成牌速度',
      value: attackPressure,
      weight: 0.24,
      description: analysis.canWin
        ? '已经成胡，节奏处于最强进攻状态'
        : analysis.tingCards.length > 0
          ? `已经有听口，离成胡只差临门一脚`
          : `距离听牌约还有 ${analysis.stepsToWin || '?'} 步`,
    });

    factors.push({
      name: '计分潜力',
      value: scoringPressure,
      weight: 0.24,
      description: totalHuPoints > 0
        ? `当前成型部分约有 ${totalHuPoints} 胡、单局潜力约 ${roundScore} 分，继续做大有价值`
        : '当前胡息偏低，更要兼顾成牌效率和名堂空间',
    });

    factors.push({
      name: '手牌整齐度',
      value: analysis.completeness || 0,
      weight: 0.2,
      description: `可联动牌占比约 ${Math.round((analysis.completeness || 0) * 100)}%`,
    });

    factors.push({
      name: '红牌与名堂空间',
      value: handCards.length === 0 ? 0 : redCount / handCards.length,
      weight: 0.14,
      description: redCount > 0
        ? `手里有 ${redCount} 张红牌，仍有继续做红或保留番数空间`
        : '当前没有红牌，后续更偏向黑牌路线或纯速度路线',
    });

    factors.push({
      name: '路线灵活度',
      value: flexibility,
      weight: 0.16,
      description: flexibility > 0.6
        ? '这手牌分路较多，可以边整理边选择快胡或做大'
        : '当前路线比较单一，一旦拆错主干，后续回旋空间会明显下降',
    });

    factors.push({
      name: '防守压力',
      value: 1 - defensePressure,
      weight: 0.18,
      description: defensePressure > 0.65
        ? '散张偏多，若强行做牌，后面容易打出生张'
        : meldCount >= 3
          ? '现有牌组较稳，防守压力相对可控'
          : '牌型还在整理阶段，需要留意节奏与失误成本',
    });

    factors.push({
      name: '即时胜率',
      value: estimatedWinRate,
      weight: 0.12,
      description: `按当前结构估计，后续成胡把握约 ${(estimatedWinRate * 100).toFixed(0)}%`,
    });

    return factors;
  }

  /**
   * 评估风险
   */
  private assessRisk(
    handCards: Card[],
    melds: Meld[],
    discardedCards: Card[],
    analysis: ReturnType<HandAnalyzer['analyze']>,
  ): number {
    let risk = 36;
    const looseRatio = (analysis.looseCards.length || 0) / Math.max(1, handCards.length);
    const redCards = handCards.filter((card) => card.isRed).length;
    const meldCount = melds.filter((meld) => meld.type !== 'pair').length;

    risk += looseRatio * 38;
    risk += Math.max(0, redCards - 2) * 4;
    risk += Math.max(0, (analysis.stepsToWin || 3) - 1) * 6;
    risk += discardedCards.length > 12 ? 8 : 0;
    risk -= meldCount * 6;
    risk -= analysis.tingCards.length > 0 ? 10 : 0;

    return Math.min(100, Math.max(0, risk));
  }

  /**
   * 计算综合评分
   */
  private calculateOverallScore(factors: StrategyFactor[]): number {
    let totalWeight = 0;
    let weightedSum = 0;

    for (const factor of factors) {
      weightedSum += (factor.value || 0) * factor.weight;
      totalWeight += factor.weight;
    }

    return totalWeight > 0 ? (weightedSum / totalWeight) * 100 : 50;
  }

  /**
   * 生成策略建议
   */
  private generateSuggestions(
    handStrength: HandStrength,
    factors: StrategyFactor[],
    riskLevel: number,
    stepsToWin: number,
    totalHuPoints: number,
    roundScore: number,
  ): string[] {
    const suggestions: string[] = [];
    const speedFactor = factors.find((factor) => factor.name === '成牌速度');
    const scoreFactor = factors.find((factor) => factor.name === '计分潜力');
    const defenseFactor = factors.find((factor) => factor.name === '防守压力');
    const flexibilityFactor = factors.find((factor) => factor.name === '路线灵活度');

    if (stepsToWin <= 1 || (speedFactor?.value || 0) > 0.72) {
      suggestions.push('现在更适合主动抢节奏，优先保留能直接听牌或做大牌的衔接');
    } else if (riskLevel >= 68 || (defenseFactor?.value || 0) < 0.35) {
      suggestions.push('当前更像防守回合，先处理孤张和危险生张，降低放炮概率');
    } else if ((scoreFactor?.value || 0) > 0.55 || totalHuPoints >= 10 || roundScore >= 8) {
      suggestions.push('这手牌已经有一定计分基础，不必只求快胡，也要兼顾番数和成型质量');
    } else {
      suggestions.push('这手牌处于中段整理期，先把结构理顺，再决定要不要强攻');
    }

    if ((flexibilityFactor?.value || 0) > 0.58) {
      suggestions.push('当前仍有多条成型路线，出牌时优先保留能同时兼顾顺子、对子和大小搭的核心张');
    }

    if (handStrength === HandStrength.VERY_STRONG || handStrength === HandStrength.STRONG) {
      suggestions.push('牌力偏强，优先保留核心搭子，不要为了眼前小利拆掉主干');
    } else if (handStrength === HandStrength.WEAK || handStrength === HandStrength.VERY_WEAK) {
      suggestions.push('牌力偏弱，先打低效率牌，尽量少把关键红牌和搭子一起送掉');
    }

    if (riskLevel > 70) {
      suggestions.push('风险已经偏高，若没有明显增益，宁可慢一点，也不要轻易打生张试探');
    }

    return suggestions;
  }

  /**
   * 获取手牌强度等级
   */
  getHandStrengthLevel(handCards: Card[], melds: Meld[]): HandStrength {
    const strength = this.handAnalyzer.calculateStrength(handCards, melds);

    if (strength >= 80) return HandStrength.VERY_STRONG;
    if (strength >= 60) return HandStrength.STRONG;
    if (strength >= 40) return HandStrength.MEDIUM;
    if (strength >= 20) return HandStrength.WEAK;
    return HandStrength.VERY_WEAK;
  }
}
