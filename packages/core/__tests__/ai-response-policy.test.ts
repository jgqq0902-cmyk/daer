import { describe, expect, it, beforeEach } from 'vitest';

import { AIPlayerAgent } from '../src/ai/ai-player-agent';
import { AIAnalyzer } from '../src/ai/ai-analyzer';
import { buildPolicyFeatures } from '../src/ai/policy-feature-builder';
import { loadPolicyArtifact, DEFAULT_POLICY_ARTIFACT } from '../src/ai/policy-artifact';
import { Card, CardSize, GamePhase, GameState, PlayerHand } from '../src/shared/types';

const SMALL_RANKS = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十'] as const;
const BIG_RANKS = ['壹', '贰', '叁', '肆', '伍', '陆', '柒', '捌', '玖', '拾'] as const;

function createCard(size: CardSize, value: number, id: string): Card {
  const isRed = [2, 7, 10].includes(value);
  const rank = size === CardSize.SMALL ? SMALL_RANKS[value - 1] : BIG_RANKS[value - 1];
  return {
    id,
    rank,
    size,
    value: value as Card['value'],
    color: isRed ? 'red' as Card['color'] : 'black' as Card['color'],
    isRed,
  };
}

function createPlayers(): PlayerHand[] {
  return [
    {
      playerId: 'player_0',
      playerName: '玩家0',
      cards: [],
      melds: [],
      isCurrentPlayer: true,
      isDealer: true,
      hasEightBlocks: false,
      totalScore: 0,
      passedPlays: [],
      chiHistory: [],
    },
    {
      playerId: 'player_1',
      playerName: '玩家1',
      cards: [],
      melds: [],
      isCurrentPlayer: false,
      isDealer: false,
      hasEightBlocks: false,
      totalScore: 0,
      passedPlays: [],
      chiHistory: [],
    },
    {
      playerId: 'player_2',
      playerName: '玩家2',
      cards: [],
      melds: [],
      isCurrentPlayer: false,
      isDealer: false,
      hasEightBlocks: false,
      totalScore: 0,
      passedPlays: [],
      chiHistory: [],
    },
  ];
}

function buildResponseState(): GameState {
  const players = createPlayers();
  players[0].cards = [
    createCard(CardSize.SMALL, 1, 's1'),
    createCard(CardSize.SMALL, 2, 's2'),
    createCard(CardSize.SMALL, 3, 's3'),
    createCard(CardSize.SMALL, 4, 's4'),
    createCard(CardSize.BIG, 1, 'b1'),
    createCard(CardSize.BIG, 2, 'b2'),
    createCard(CardSize.BIG, 3, 'b3'),
    createCard(CardSize.BIG, 4, 'b4'),
    createCard(CardSize.BIG, 5, 'b5'),
    createCard(CardSize.BIG, 6, 'b6'),
    createCard(CardSize.SMALL, 5, 's5'),
    createCard(CardSize.SMALL, 6, 's6'),
    createCard(CardSize.SMALL, 7, 's7'),
    createCard(CardSize.SMALL, 8, 's8'),
    createCard(CardSize.SMALL, 9, 's9'),
    createCard(CardSize.SMALL, 10, 's10'),
    createCard(CardSize.BIG, 7, 'b7'),
    createCard(CardSize.BIG, 8, 'b8'),
    createCard(CardSize.BIG, 9, 'b9'),
    createCard(CardSize.BIG, 10, 'b10'),
  ];

  const lastDiscard = createCard(CardSize.SMALL, 4, 'discard_s4');
  return {
    players,
    currentPlayerIndex: 0,
    discardPile: {
      cards: [lastDiscard],
      lastDiscard,
      lastDiscardPlayerIndex: 1,
    },
    tableMelds: [],
    phase: GamePhase.RESPONSE_COLLECTING,
    turnCount: 6,
    isGameOver: false,
    remainingDeckCards: 18,
    availableActions: [
      {
        type: 'pass',
        cards: [],
        isMandatory: false,
        description: '过张',
      },
    ],
    pendingResponses: [],
    pendingCardSource: 'discard',
    skipDiscardAfterZhao: false,
  };
}

describe('AI response policy integration', () => {
  beforeEach(() => {
    loadPolicyArtifact({ ...DEFAULT_POLICY_ARTIFACT, policyVersion: 'test-policy-v1' });
  });

  it('enriches response recommendations with learned policy fields', async () => {
    const analyzer = new AIAnalyzer();
    const state = buildResponseState();

    const analysis = await analyzer.analyze(state, 0, {
      policyMode: 'learned',
      discardTopK: 5,
      chiOptionTopK: 3,
    });

    const passRecommendation = analysis.recommendations.find((item) => item.action === 'pass');
    expect(passRecommendation).toBeTruthy();
    expect(typeof passRecommendation?.winRate).toBe('number');
    expect(typeof passRecommendation?.expectedScore).toBe('number');
    expect(typeof passRecommendation?.priority).toBe('number');
    expect(typeof passRecommendation?.policyScore).toBe('number');
    expect(typeof passRecommendation?.predictedWinRate).toBe('number');
    expect(typeof passRecommendation?.predictedExpectedScore).toBe('number');
    expect(passRecommendation?.policySource).toBe('learned');
    expect(passRecommendation?.policyVersion).toBe('test-policy-v1');
    expect(passRecommendation?.baselinePriority).toBeDefined();

    const rankedPass = analysis.rankedActions?.find((item) => item.availableAction.type === 'pass');
    expect(rankedPass?.recommendation).toBeTruthy();
  });

  it('builds distinct lightweight policy features for response actions', () => {
    const baseState = buildResponseState();
    const pass = buildPolicyFeatures({
      action: 'pass',
      reasoning: '先过，当前这张牌带来的即时收益还不够大',
      winRate: 0.42,
      expectedScore: 4,
      riskLevel: 'low',
      priority: 36,
      evidence: {
        tempoGain: 0,
        ukeireCount: 4,
        dangerScore: 20,
        flexibility: 0.62,
        signals: ['当前这张牌带来的即时收益还不够大'],
      },
    }, undefined, baseState);
    const chi = buildPolicyFeatures({
      action: 'chi',
      reasoning: '吃这张后会明显提速，吃后还有明确的继续整理方案',
      meldCards: [
        createCard(CardSize.SMALL, 3, 'chi_s3'),
        createCard(CardSize.SMALL, 4, 'chi_s4'),
        createCard(CardSize.SMALL, 5, 'chi_s5'),
      ],
      winRate: 0.48,
      expectedScore: 8,
      riskLevel: 'medium',
      priority: 52,
      evidence: {
        tempoGain: 1,
        ukeireCount: 7,
        dangerScore: 44,
        flexibility: 0.42,
        signals: ['顺子衔接更顺', '吃后还有明确的继续整理方案'],
      },
    }, undefined, baseState);
    const peng = buildPolicyFeatures({
      action: 'peng',
      reasoning: '碰这张能把眼前收益先立住',
      winRate: 0.46,
      expectedScore: 6,
      riskLevel: 'medium',
      priority: 48,
      evidence: {
        tempoGain: 0.4,
        ukeireCount: 5,
        dangerScore: 48,
        flexibility: 0.34,
        signals: ['这手更像主动立分'],
      },
    }, undefined, baseState);
    const zhao = buildPolicyFeatures({
      action: 'zhao',
      reasoning: '招牌通常不会像碰牌那样明显破坏主干',
      winRate: 0.55,
      expectedScore: 12,
      riskLevel: 'low',
      priority: 66,
      evidence: {
        tempoGain: 0.6,
        ukeireCount: 6,
        dangerScore: 28,
        flexibility: 0.48,
        signals: ['招牌通常不会像碰牌那样明显破坏主干'],
      },
    }, undefined, baseState);

    expect(pass.actionFamily).toBe('response');
    expect(chi.features.response_action_chi).toBe(1);
    expect(peng.features.response_action_peng).toBe(1);
    expect(zhao.features.response_action_zhao).toBe(1);
    expect(pass.features.response_action_pass).toBe(1);
    expect(chi.features.response_value).toBeGreaterThan(pass.features.response_value);
    expect(chi.hasStructuralCoverage).toBe(true);
    expect(zhao.hasStructuralCoverage).toBe(true);
  });

  it('keeps hu and mandatory responses ahead of learned policy reranking', async () => {
    const baseState = buildResponseState();
    const huState: GameState = {
      ...baseState,
      availableActions: [
        {
          type: 'hu',
          cards: [],
          isMandatory: false,
          description: '胡牌',
        },
        {
          type: 'pass',
          cards: [],
          isMandatory: false,
          description: '过张',
        },
      ],
    };
    const huDecision = await new AIPlayerAgent('player_0', { mode: 'learned' }).decideWithTrace(huState);
    expect(huDecision.action.type).toBe('hu');
    expect(huDecision.trace.legal.explicitHuTaken).toBe(true);

    const mandatoryState: GameState = {
      ...baseState,
      availableActions: [
        {
          type: 'peng',
          cards: [createCard(CardSize.SMALL, 4, 'mandatory_s4a'), createCard(CardSize.SMALL, 4, 'mandatory_s4b')],
          isMandatory: true,
          description: '有碰必碰',
        },
        {
          type: 'pass',
          cards: [],
          isMandatory: false,
          description: '过张',
        },
      ],
    };
    const mandatoryDecision = await new AIPlayerAgent('player_0', { mode: 'learned' }).decideWithTrace(mandatoryState);
    expect(mandatoryDecision.action.type).toBe('peng');
    expect(mandatoryDecision.trace.legal.mandatoryRespected).toBe(true);
  });
});
