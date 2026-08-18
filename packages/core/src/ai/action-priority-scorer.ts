interface DiscardCandidateScoreParams {
  beforeWaitCount: number;
  breakdownTotal: number;
  compositeScore: number;
  keepValue: number;
  waitCount: number;
  remainingWaitCount: number;
  maxRoundScore: number;
  isRed: boolean;
  isIsolated: boolean;
  isNearlyDead: boolean;
  preservesTempo: boolean;
  shapeAnchorStrength: number;
  exactMeldAnchorStrength: number;
  stableStructureLoss: number;
}

interface DiscardPriorityParams {
  rankIndex: number;
  breakdownTotal: number;
  speedScore: number;
  candidateScore: number;
  winRate: number;
  expectedScore: number;
  trashQueueRank: number;
  pseudoLooseRank: number;
}

interface ResponseDeltaParams {
  breakdownTotal: number;
  evaluationCompositeScore: number;
  passCompositeScore: number;
}

interface ChiRawDeltaParams {
  evaluationCompositeScore: number;
  passCompositeScore: number;
  formedUnitDelta: number;
  tingDelta: number;
  stepDelta: number;
  huDelta: number;
  followUpWaitDelta: number;
  followUpScoreDelta: number;
  selfDraw: boolean;
  routeImproved: boolean;
}

interface ChiDeltaParams {
  rawDelta: number;
  breakdownTotal: number;
}

interface ChiPriorityParams {
  breakdownTotal: number;
  delta: number;
}

interface PostResponseDiscardScoreParams {
  compositeScore: number;
  keepValue: number;
  waitCount: number;
  remainingWaitCount: number;
  maxRoundScore: number;
  avgHuPoints: number;
  dangerScore: number;
}

export class ActionPriorityScorer {
  scoreDiscardCandidate(params: DiscardCandidateScoreParams): number {
    const listeningBonus = params.waitCount > 0
      ? (params.beforeWaitCount > 0 ? 260 : 1000) + params.remainingWaitCount * 14 + params.maxRoundScore * 3
      : 0;
    const tingBonus = params.waitCount > 0
      ? params.waitCount * 28 + params.remainingWaitCount * 5 + params.maxRoundScore * 1.8
      : 0;
    const deadTileBonus = params.isIsolated ? 42 : params.isNearlyDead ? 18 : 0;
    const trashQueueBonus = params.isIsolated && params.preservesTempo ? 88 : params.isNearlyDead && params.preservesTempo ? 20 : 0;
    const stableStructurePenalty = params.stableStructureLoss * 52;
    const anchorPenalty = params.shapeAnchorStrength * 1.2 + params.exactMeldAnchorStrength * 68;
    const redDangerPenalty = params.isRed ? 20 : 0;

    return params.breakdownTotal + params.compositeScore * 0.18 - params.keepValue + listeningBonus + tingBonus + deadTileBonus + trashQueueBonus - stableStructurePenalty - anchorPenalty - redDangerPenalty;
  }

  scoreDiscardPriority(params: DiscardPriorityParams): number {
    return Math.round(
      56
      + params.candidateScore * 0.18
      - params.rankIndex * 6
      + params.breakdownTotal * 0.04
      + params.speedScore * 6
      + params.winRate * 18
      + params.expectedScore * 1.4
      + params.trashQueueRank * 4
      + params.pseudoLooseRank * 2,
    );
  }

  scorePassPriority(breakdownTotal: number): number {
    return Math.round(36 + breakdownTotal * 0.04);
  }

  scoreResponseDelta(params: ResponseDeltaParams): number {
    return params.breakdownTotal * 0.05 + (params.evaluationCompositeScore - params.passCompositeScore);
  }

  scoreResponsePriority(basePriority: number, breakdownTotal: number): number {
    return Math.round(basePriority + breakdownTotal * 0.06);
  }

  scoreChiRawDelta(params: ChiRawDeltaParams): number {
    const followUpBonus = params.followUpWaitDelta * 10 + params.followUpScoreDelta * 1.5;
    const selfDrawTempoBonus = params.selfDraw
      ? 8 + Math.max(0, params.stepDelta) * 2
      : 0;
    const routeBonus = params.routeImproved ? 4 : 0;
    const staleRoutePenalty = !params.routeImproved && params.stepDelta <= 0 && params.tingDelta <= 0 && params.followUpWaitDelta <= 0 && params.followUpScoreDelta <= 0
      ? 10
      : 0;

    return (params.evaluationCompositeScore - params.passCompositeScore)
      + params.formedUnitDelta * 6
      + params.tingDelta * 4
      + params.stepDelta * 5
      + params.huDelta * 1.6
      + followUpBonus
      + selfDrawTempoBonus
      + routeBonus
      - staleRoutePenalty;
  }

  scoreChiDelta(params: ChiDeltaParams): number {
    return params.rawDelta + Math.max(0, params.breakdownTotal) * 0.03;
  }

  scoreChiPriority(params: ChiPriorityParams): number {
    return Math.round(44 + params.breakdownTotal * 0.06 + Math.max(params.delta, 0) * 0.4);
  }

  scorePostResponseDiscard(params: PostResponseDiscardScoreParams): number {
    return params.compositeScore
      - params.keepValue
      + params.waitCount * 24
      + params.remainingWaitCount * 8
      + params.maxRoundScore * 2
      + params.avgHuPoints
      - params.dangerScore * 0.55;
  }
}
