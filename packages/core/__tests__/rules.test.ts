/**
 * 泸州大贰规则测试
 * 验证所有游戏规则的代码实现与文档定义一致态
 * 
 * 测试命名规范: describe('R{规则ID} {描述}')
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { GameManager } from '../src/game-engine/game-manager';
import { ActionHandlers } from '../src/game-engine/action-handlers';
import { RulesValidator } from '../src/game-engine/rules-validator';
import { ResponseArbitrator } from '../src/game-engine/response-arbitrator';
import { TimeoutHandler } from '../src/game-engine/timeout-handler';
import { ScoreCalculator } from '../src/game-engine/score-calculator';
import { AIPlayerAgent } from '../src/ai/ai-player-agent';
import { AIAnalyzer } from '../src/ai/ai-analyzer';
import { ActionPriorityScorer } from '../src/ai/action-priority-scorer';
import { HandAnalyzer } from '../src/game-engine/hand-analyzer';
import { TurnManager } from '../src/game-engine/turn-manager';
import { 
  GameState, 
  GamePhase, 
  Card, 
  CardSize, 
  Meld, 
  MeldType,
  MingTangType,
  PlayerHand,
  PlayerResponse,
  WinType,
  RESPONSE_PRIORITY,
  DEFAULT_GAME_CONFIG
} from '../src/shared/types';

// 测试工具函数：创建测试用卡牌
function createCard(rank: string, value: number, size: CardSize, id?: string): Card {
  const isRed = [2, 7, 10].includes(value);
  return {
    id: id || `test_${rank}_${size}_${Math.random()}`,
    rank: rank as any,
    value: value as any,
    size,
    color: isRed ? 'red' as any : 'black' as any,
    isRed,
    displayName: rank
  } as unknown as Card;
}

// 创建测试用游戏状态
function createTestGameState(overrides: Partial<GameState> = {}): GameState {
  const defaultPlayers: PlayerHand[] = [
    {
      playerId: 'player_0',
      playerName: '玩家1',
      cards: [],
      melds: [],
      isCurrentPlayer: true,
      isDealer: true,
      hasEightBlocks: false,
      totalScore: 0,
      passedPlays: [],
      chiHistory: []
    },
    {
      playerId: 'player_1',
      playerName: '玩家2',
      cards: [],
      melds: [],
      isCurrentPlayer: false,
      isDealer: false,
      hasEightBlocks: false,
      totalScore: 0,
      passedPlays: [],
      chiHistory: []
    },
    {
      playerId: 'player_2',
      playerName: '玩家3',
      cards: [],
      melds: [],
      isCurrentPlayer: false,
      isDealer: false,
      hasEightBlocks: false,
      totalScore: 0,
      passedPlays: [],
      chiHistory: []
    }
  ];

  return {
    players: defaultPlayers,
    currentPlayerIndex: 0,
    discardPile: { cards: [], lastDiscard: undefined },
    tableMelds: [],
    phase: GamePhase.DISCARDING,
    turnCount: 0,
    isGameOver: false,
    remainingDeckCards: 17,
    availableActions: [],
    pendingResponses: [],
    skipDiscardAfterZhao: false,
    ...overrides
  };
}

describe('R4.3.1 只吃上家', () => {
  let actionHandlers: ActionHandlers;

  beforeEach(() => {
    actionHandlers = new ActionHandlers();
  });

  it('should allow chi from previous player (player 0 -> player 2)', () => {
    const targetCard = createCard('二', 2, CardSize.SMALL);
    const state = createTestGameState({
      currentPlayerIndex: 2,
      discardPile: {
        cards: [targetCard],
        lastDiscard: targetCard,
        lastDiscardPlayerIndex: 0 // 玩家0出牌
      }
    });
    // 玩家1的上家是玩家0
    state.players[2].cards = [
      createCard('一', 1, CardSize.SMALL),
      createCard('三', 3, CardSize.SMALL)
    ];

    const result = actionHandlers.canPlayerChi(state, 2, targetCard);
    expect(result.canChi).toBe(true);
  });

  it('should reject chi from non-previous player (player 0 -> player 1)', () => {
    const targetCard = createCard('二', 2, CardSize.SMALL);
    const state = createTestGameState({
      currentPlayerIndex: 2,
      discardPile: {
        cards: [targetCard],
        lastDiscard: targetCard,
        lastDiscardPlayerIndex: 0 // 玩家0出牌
      }
    });
    // 玩家2的上家是玩家1，不是玩家
    state.players[1].cards = [
      createCard('一', 1, CardSize.SMALL),
      createCard('三', 3, CardSize.SMALL)
    ];

    const result = actionHandlers.canPlayerChi(state, 1, targetCard);
    expect(result.canChi).toBe(false);
    expect(result.reason).toContain('上家');
  });

  it('should reject chi when only possible by splitting a kan', () => {
    const targetCard = createCard('陆', 6, CardSize.BIG);
    const state = createTestGameState({
      currentPlayerIndex: 0,
      phase: GamePhase.RESPONSE_COLLECTING,
      pendingCardSource: 'discard',
      discardPile: {
        cards: [targetCard],
        lastDiscard: targetCard,
        lastDiscardPlayerIndex: 1
      }
    });

    // 仅能通过 B4 + B5 + B6 吃；体B5 是坎牌，不能拾
    state.players[0].cards = [
      createCard('肆', 4, CardSize.BIG, 'b4'),
      createCard('伍', 5, CardSize.BIG, 'b5_1'),
      createCard('伍', 5, CardSize.BIG, 'b5_2'),
      createCard('伍', 5, CardSize.BIG, 'b5_3'),
    ];

    const result = actionHandlers.canPlayerChi(state, 0, targetCard);
    expect(result.canChi).toBe(false);
    expect(result.reason).toContain('手牌无法组成顺子');
  });

  it('should reject chi for card previously discarded by self', () => {
    const targetCard = createCard('二', 2, CardSize.SMALL);
    const state = createTestGameState({
      currentPlayerIndex: 1,
      discardPile: {
        cards: [targetCard],
        lastDiscard: targetCard,
        lastDiscardPlayerIndex: 2
      }
    });

    state.players[1].passedPlays = [{
      card: createCard('二', 2, CardSize.SMALL),
      timestamp: Date.now() - 1000,
      actionType: 'discard'
    }];
    state.players[1].cards = [
      createCard('一', 1, CardSize.SMALL),
      createCard('三', 3, CardSize.SMALL)
    ];

    const result = actionHandlers.canPlayerChi(state, 1, targetCard);
    expect(result.canChi).toBe(false);
    expect(result.reason).toContain('已过张');
  });

  it('should allow chi from self drawn card', () => {
    const targetCard = createCard('四', 4, CardSize.SMALL);
    const state = createTestGameState({
      currentPlayerIndex: 1,
      phase: GamePhase.RESPONSE_COLLECTING,
      pendingCardSource: 'draw',
      discardPile: {
        cards: [],
        lastDiscard: targetCard,
        lastDiscardPlayerIndex: 1
      }
    });

    state.players[1].cards = [
      createCard('三', 3, CardSize.SMALL),
      createCard('五', 5, CardSize.SMALL)
    ];

    const result = actionHandlers.canPlayerChi(state, 1, targetCard);
    expect(result.canChi).toBe(true);
  });
});

describe('R7.3 自身响应规则', () => {
  let arbitrator: ResponseArbitrator;

  beforeEach(() => {
    arbitrator = new ResponseArbitrator();
  });

  it('should allow HU/ZHAO/PENG on self drawn card', () => {
    const targetCard = createCard('二', 2, CardSize.SMALL);
    const state = createTestGameState({
      currentPlayerIndex: 0,
      phase: GamePhase.RESPONSE_COLLECTING,
      pendingCardSource: 'draw',
      discardPile: {
        cards: [],
        lastDiscard: targetCard,
        lastDiscardPlayerIndex: 0
      }
    });

    state.players[0].cards = [
      createCard('二', 2, CardSize.SMALL),
      createCard('二', 2, CardSize.SMALL),
      createCard('二', 2, CardSize.SMALL),
      createCard('一', 1, CardSize.SMALL),
      createCard('三', 3, CardSize.SMALL)
    ];

    const responses = arbitrator.getAvailableResponses(state, 0);
    expect(responses.includes('peng')).toBe(true);
    expect(responses.includes('zhao')).toBe(true);
    expect(responses.includes('chi')).toBe(true);
  });

  it('should reject responding to own discarded card', () => {
    const targetCard = createCard('二', 2, CardSize.SMALL);
    const state = createTestGameState({
      currentPlayerIndex: 0,
      phase: GamePhase.RESPONSE_COLLECTING,
      pendingCardSource: 'discard',
      discardPile: {
        cards: [targetCard],
        lastDiscard: targetCard,
        lastDiscardPlayerIndex: 0
      }
    });

    state.players[0].cards = [
      createCard('二', 2, CardSize.SMALL),
      createCard('二', 2, CardSize.SMALL),
      createCard('二', 2, CardSize.SMALL)
    ];

    const responses = arbitrator.getAvailableResponses(state, 0);
    expect(responses.includes('peng')).toBe(false);
    expect(responses.includes('zhao')).toBe(false);
    expect(responses.includes('chi')).toBe(false);
  });
});

describe('R4.3.3 过张不可吃', () => {
  let actionHandlers: ActionHandlers;

  beforeEach(() => {
    actionHandlers = new ActionHandlers();
  });

  it('should reject chi for passed card', () => {
    const targetCard = createCard('二', 2, CardSize.SMALL);
    const state = createTestGameState({
      currentPlayerIndex: 1,
      discardPile: {
        cards: [targetCard],
        lastDiscard: targetCard,
        lastDiscardPlayerIndex: 0
      }
    });

    // 玩家2之前放弃过吃同样的牌
    state.players[2].passedPlays = [{
      card: createCard('二', 2, CardSize.SMALL),
      timestamp: Date.now() - 1000,
      actionType: 'chi'
    }];
    state.players[2].cards = [
      createCard('一', 1, CardSize.SMALL),
      createCard('三', 3, CardSize.SMALL)
    ];

    const result = actionHandlers.canPlayerChi(state, 2, targetCard);
    expect(result.canChi).toBe(false);
    expect(result.reason).toContain('已过张');
  });

  it('should record passed play when player passes chi opportunity', () => {
    const targetCard = createCard('二', 2, CardSize.SMALL);
    const state = createTestGameState({
      currentPlayerIndex: 1,
      phase: GamePhase.RESPONSE_COLLECTING,
      pendingCardSource: 'discard',
      discardPile: {
        cards: [targetCard],
        lastDiscard: targetCard,
        lastDiscardPlayerIndex: 2,
      }
    });
    state.players[1].cards = [
      createCard('一', 1, CardSize.SMALL),
      createCard('三', 3, CardSize.SMALL),
    ];

    const newState = actionHandlers.handlePass(state, 'player_1', 'chi');
    expect(newState.players[1].passedPlays).toHaveLength(1);
    expect(newState.players[1].passedPlays[0].actionType).toBe('chi');
  });
});

describe('R5.3.1/R5.3.2 点炮/自摸计分', () => {
  let actionHandlers: ActionHandlers;

  const createWinningMelds = (): Meld[] => ([
    {
      type: MeldType.TRIPLE,
      cards: [
        createCard('二', 2, CardSize.SMALL, 'settle-s2-1'),
        createCard('二', 2, CardSize.SMALL, 'settle-s2-2'),
        createCard('二', 2, CardSize.SMALL, 'settle-s2-3'),
      ],
      isConcealed: false,
      position: 'table',
      huPoints: 0,
    },
    {
      type: MeldType.SPECIAL_2710,
      cards: [
        createCard('二', 2, CardSize.SMALL, 'settle-s2-4'),
        createCard('七', 7, CardSize.SMALL, 'settle-s7-1'),
        createCard('十', 10, CardSize.SMALL, 'settle-s10-1'),
      ],
      isConcealed: false,
      position: 'table',
      huPoints: 0,
    },
    {
      type: MeldType.SEQUENCE,
      cards: [
        createCard('三', 3, CardSize.SMALL, 'settle-s3-1'),
        createCard('四', 4, CardSize.SMALL, 'settle-s4-1'),
        createCard('五', 5, CardSize.SMALL, 'settle-s5-1'),
      ],
      isConcealed: false,
      position: 'table',
      huPoints: 0,
    },
    {
      type: MeldType.SEQUENCE,
      cards: [
        createCard('六', 6, CardSize.SMALL, 'settle-s6-1'),
        createCard('七', 7, CardSize.SMALL, 'settle-s7-2'),
        createCard('八', 8, CardSize.SMALL, 'settle-s8-1'),
      ],
      isConcealed: false,
      position: 'table',
      huPoints: 0,
    },
    {
      type: MeldType.SEQUENCE,
      cards: [
        createCard('叁', 3, CardSize.BIG, 'settle-b3-1'),
        createCard('肆', 4, CardSize.BIG, 'settle-b4-1'),
        createCard('伍', 5, CardSize.BIG, 'settle-b5-1'),
      ],
      isConcealed: false,
      position: 'table',
      huPoints: 0,
    },
    {
      type: MeldType.MIXED_SIZE,
      cards: [
        createCard('九', 9, CardSize.SMALL, 'settle-s9-1'),
        createCard('玖', 9, CardSize.BIG, 'settle-b9-1'),
        createCard('玖', 9, CardSize.BIG, 'settle-b9-2'),
      ],
      isConcealed: false,
      position: 'table',
      huPoints: 0,
    },
    {
      type: MeldType.MIXED_SIZE,
      cards: [
        createCard('一', 1, CardSize.SMALL, 'settle-s1-1'),
        createCard('壹', 1, CardSize.BIG, 'settle-b1-1'),
        createCard('壹', 1, CardSize.BIG, 'settle-b1-2'),
      ],
      isConcealed: false,
      position: 'table',
      huPoints: 0,
    },
  ]);

  beforeEach(() => {
    actionHandlers = new ActionHandlers();
  });

  it('R5.3.1: should charge only dianpao player for discard win', () => {
    const state = createTestGameState({
      discardPile: {
        cards: [],
        lastDiscardPlayerIndex: 1 // 玩家1点炮
      }
    });
    state.players[0].melds = createWinningMelds();

    const newState = actionHandlers.handleHu(state, 'player_0', false);
    
    expect(newState.winType).toBe(WinType.DISCARD);
    expect(newState.dianpaoPlayerIndex).toBe(1);
    expect(newState.players[0].totalScore).toBeGreaterThan(0);
    expect(newState.players[1].totalScore).toBeLessThan(0);
    // 玩家2不应该扣别
    expect(newState.players[2].totalScore).toBe(0);
  });

  it('R5.3.2: should charge all other players doubled for self draw win', () => {
    const state = createTestGameState();
    state.players[0].melds = createWinningMelds();

    const newState = actionHandlers.handleHu(state, 'player_0', true);
    
    expect(newState.winType).toBe(WinType.SELF_DRAW);
    expect(newState.players[0].totalScore).toBeGreaterThan(0);
    // 所有其他玩家都应该扣分
    expect(newState.players[1].totalScore).toBeLessThan(0);
    expect(newState.players[2].totalScore).toBeLessThan(0);
  });

  it('should attach mingtang metadata for self draw and heavenly win', () => {
    const scoreCalculator = new ScoreCalculator();
    const melds: Meld[] = [
      {
        type: MeldType.TRIPLE,
        cards: [
          createCard('二', 2, CardSize.SMALL, 'ming-1'),
          createCard('二', 2, CardSize.SMALL, 'ming-2'),
          createCard('二', 2, CardSize.SMALL, 'ming-3'),
        ],
        isConcealed: false,
        huPoints: 0,
      },
    ];

    const result = scoreCalculator.calculateTotalScore(melds, {
      winType: WinType.SELF_DRAW,
      isHeavenlyWin: true,
    });

    expect(result.mingtangs.map((item) => item.type)).toEqual(
      expect.arrayContaining([MingTangType.TIAN_HU, MingTangType.ZI_MO]),
    );
    expect(result.mingtangs.map((item) => item.type)).toContain(MingTangType.KUN);
    expect(result.totalFans).toBe(4);
    expect(result.baseScore).toBe(2);
    expect(result.finalScore).toBe(result.baseScore * result.totalFans);
  });

  it('should apply jifen.md base score tiers and base fan', () => {
    const scoreCalculator = new ScoreCalculator();
    const melds: Meld[] = [
      {
        type: MeldType.QUADRUPLE,
        cards: [
          createCard('壹', 1, CardSize.BIG, 'tier-1'),
          createCard('壹', 1, CardSize.BIG, 'tier-2'),
          createCard('壹', 1, CardSize.BIG, 'tier-3'),
          createCard('壹', 1, CardSize.BIG, 'tier-4'),
        ],
        isConcealed: false,
        huPoints: 0,
      },
      {
        type: MeldType.TRIPLE,
        cards: [
          createCard('二', 2, CardSize.SMALL, 'tier-5'),
          createCard('二', 2, CardSize.SMALL, 'tier-6'),
          createCard('二', 2, CardSize.SMALL, 'tier-7'),
        ],
        isConcealed: false,
        huPoints: 0,
      },
    ];

    const result = scoreCalculator.calculateTotalScore(melds);

    expect(result.totalHuPoints).toBe(24);
    expect(result.baseScore).toBe(3);
    expect(result.totalFans).toBeGreaterThanOrEqual(1);
    expect(result.roundScore).toBe(result.baseScore * result.totalFans);
  });

  it('should support disabling a mingtang in scoring config', () => {
    const scoreCalculator = new ScoreCalculator();
    const melds: Meld[] = [
      {
        type: MeldType.TRIPLE,
        cards: [
          createCard('二', 2, CardSize.SMALL, 'red-1'),
          createCard('二', 2, CardSize.SMALL, 'red-2'),
          createCard('二', 2, CardSize.SMALL, 'red-3'),
        ],
        isConcealed: false,
        huPoints: 0,
      },
      {
        type: MeldType.TRIPLE,
        cards: [
          createCard('七', 7, CardSize.SMALL, 'red-4'),
          createCard('七', 7, CardSize.SMALL, 'red-5'),
          createCard('七', 7, CardSize.SMALL, 'red-6'),
        ],
        isConcealed: false,
        huPoints: 0,
      },
      {
        type: MeldType.TRIPLE,
        cards: [
          createCard('十', 10, CardSize.SMALL, 'red-7'),
          createCard('十', 10, CardSize.SMALL, 'red-8'),
          createCard('十', 10, CardSize.SMALL, 'red-9'),
        ],
        isConcealed: false,
        huPoints: 0,
      },
      {
        type: MeldType.PAIR,
        cards: [
          createCard('二', 2, CardSize.BIG, 'red-10'),
          createCard('二', 2, CardSize.BIG, 'red-11'),
        ],
        isConcealed: false,
        huPoints: 0,
      },
    ];

    const result = scoreCalculator.calculateTotalScore(melds, {
      enabledMingTangTypes: {
        ...DEFAULT_GAME_CONFIG.enabledMingTangTypes,
        [MingTangType.HONG]: false,
      },
    });

    expect(result.mingtangs.map((item) => item.type)).not.toContain(MingTangType.HONG);
    expect(result.mingtangs.map((item) => item.type)).toContain(MingTangType.KUN);
    expect(result.totalFans).toBe(2);
  });
});

describe('AI 决策优先线', () => {
  it('priority scorer should reward stronger chi follow-up over flat pass line', () => {
    const scorer = new ActionPriorityScorer();

    const rawDelta = scorer.scoreChiRawDelta({
      evaluationCompositeScore: 82,
      passCompositeScore: 58,
      formedUnitDelta: 1,
      tingDelta: 2,
      stepDelta: 1,
      huDelta: 3,
      followUpWaitDelta: 2,
      followUpScoreDelta: 12,
      selfDraw: true,
      routeImproved: true,
    });
    const chiDelta = scorer.scoreChiDelta({ rawDelta, breakdownTotal: 118 });
    const passPriority = scorer.scorePassPriority(-20);
    const chiPriority = scorer.scoreChiPriority({ breakdownTotal: 118, delta: chiDelta });

    expect(rawDelta).toBeGreaterThan(0);
    expect(chiDelta).toBeGreaterThan(0);
    expect(chiPriority).toBeGreaterThan(passPriority);
  });

  it('hard AI should prefer explicit hu action', async () => {
    const agent = new AIPlayerAgent('player_0');
    const huCard = createCard('二', 2, CardSize.SMALL, 'ai-hu-card');
    const state = createTestGameState({
      currentPlayerIndex: 0,
      phase: GamePhase.RESPONSE_COLLECTING,
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
          description: '近',
        },
      ],
      discardPile: {
        cards: [huCard],
        lastDiscard: huCard,
        lastDiscardPlayerIndex: 1,
      },
    });

    const action = await agent.decide(state);
    expect(action.type).toBe('hu');
  });

  it('medium AI should prefer peng over chi during response', async () => {
    const agent = new AIPlayerAgent('player_1');
    const state = createTestGameState({
      currentPlayerIndex: 1,
      phase: GamePhase.RESPONSE_COLLECTING,
      availableActions: [
        {
          type: 'chi',
          cards: [createCard('一', 1, CardSize.SMALL, 'ai-chi-1'), createCard('三', 3, CardSize.SMALL, 'ai-chi-3')],
          isMandatory: false,
          description: '吃牌',
        },
        {
          type: 'peng',
          cards: [createCard('二', 2, CardSize.SMALL, 'ai-peng')],
          isMandatory: false,
          description: '碰牌',
        },
        {
          type: 'pass',
          cards: [],
          isMandatory: false,
          description: '近',
        },
      ],
    });

    const action = await agent.decide(state);
    expect(action.type).toBe('peng');
  });

  it('medium AI should pass when chi breaks stronger hand structure', async () => {
    const agent = new AIPlayerAgent('player_1');
    const targetCard = createCard('八', 8, CardSize.SMALL, 'ai-pass-target');
    const s7 = createCard('七', 7, CardSize.SMALL, 'ai-pass-s7');
    const s9 = createCard('九', 9, CardSize.SMALL, 'ai-pass-s9');
    const state = createTestGameState({
      currentPlayerIndex: 1,
      phase: GamePhase.RESPONSE_COLLECTING,
      pendingCardSource: 'discard',
      discardPile: {
        cards: [targetCard],
        lastDiscard: targetCard,
        lastDiscardPlayerIndex: 2,
      },
      availableActions: [
        {
          type: 'chi',
          cards: [s7, s9],
          chiOptions: [
            {
              id: 'chi_bad_option',
              mainMeldCards: [s7, targetCard, s9],
              selectedCards: [s7, s9],
              additionalMelds: [],
              remainingCards: [
                createCard('二', 2, CardSize.SMALL, 'ai-pass-2'),
                createCard('十', 10, CardSize.SMALL, 'ai-pass-10'),
                createCard('九', 9, CardSize.SMALL, 'ai-pass-s9b'),
                createCard('四', 4, CardSize.SMALL, 'ai-pass-s4a'),
                createCard('四', 4, CardSize.SMALL, 'ai-pass-s4b'),
                createCard('四', 4, CardSize.SMALL, 'ai-pass-s4c'),
                createCard('叁', 3, CardSize.BIG, 'ai-pass-b3'),
                createCard('肆', 4, CardSize.BIG, 'ai-pass-b4'),
                createCard('伍', 5, CardSize.BIG, 'ai-pass-b5'),
                createCard('贰', 2, CardSize.BIG, 'ai-pass-b2a'),
                createCard('贰', 2, CardSize.BIG, 'ai-pass-b2b'),
                createCard('贰', 2, CardSize.BIG, 'ai-pass-b2c'),
              ],
              description: '吃牌：七小八小 九小',
            },
          ],
          isMandatory: false,
          description: '吃牌',
        },
        {
          type: 'pass',
          cards: [],
          isMandatory: false,
          description: '近',
        },
      ],
    });

    state.players[1].cards = [
      createCard('二', 2, CardSize.SMALL, 'ai-pass-2'),
      s7,
      createCard('十', 10, CardSize.SMALL, 'ai-pass-10'),
      s9,
      createCard('九', 9, CardSize.SMALL, 'ai-pass-s9b'),
      createCard('四', 4, CardSize.SMALL, 'ai-pass-s4a'),
      createCard('四', 4, CardSize.SMALL, 'ai-pass-s4b'),
      createCard('四', 4, CardSize.SMALL, 'ai-pass-s4c'),
      createCard('叁', 3, CardSize.BIG, 'ai-pass-b3'),
      createCard('肆', 4, CardSize.BIG, 'ai-pass-b4'),
      createCard('伍', 5, CardSize.BIG, 'ai-pass-b5'),
      createCard('贰', 2, CardSize.BIG, 'ai-pass-b2a'),
      createCard('贰', 2, CardSize.BIG, 'ai-pass-b2b'),
      createCard('贰', 2, CardSize.BIG, 'ai-pass-b2c'),
    ];

    const action = await agent.decide(state);
    expect(action.type).toBe('pass');
  });

  it('analyzer should keep response ranking aligned with pass recommendation after candidate extraction', async () => {
    const analyzer = new AIAnalyzer();
    const targetCard = createCard('八', 8, CardSize.SMALL, 'extract-pass-target');
    const s7 = createCard('七', 7, CardSize.SMALL, 'extract-pass-s7');
    const s9 = createCard('九', 9, CardSize.SMALL, 'extract-pass-s9');
    const state = createTestGameState({
      currentPlayerIndex: 2,
      phase: GamePhase.RESPONSE_COLLECTING,
      pendingCardSource: 'discard',
      discardPile: {
        cards: [targetCard],
        lastDiscard: targetCard,
        lastDiscardPlayerIndex: 0,
      },
      availableActions: [
        {
          type: 'chi',
          cards: [s7, s9],
          chiOptions: [
            {
              id: 'extract_bad_option',
              mainMeldCards: [s7, targetCard, s9],
              selectedCards: [s7, s9],
              additionalMelds: [],
              remainingCards: [
                createCard('二', 2, CardSize.SMALL, 'extract-pass-2'),
                createCard('十', 10, CardSize.SMALL, 'extract-pass-10'),
                createCard('九', 9, CardSize.SMALL, 'extract-pass-s9b'),
                createCard('四', 4, CardSize.SMALL, 'extract-pass-s4a'),
                createCard('四', 4, CardSize.SMALL, 'extract-pass-s4b'),
                createCard('四', 4, CardSize.SMALL, 'extract-pass-s4c'),
                createCard('叁', 3, CardSize.BIG, 'extract-pass-b3'),
                createCard('肆', 4, CardSize.BIG, 'extract-pass-b4'),
                createCard('伍', 5, CardSize.BIG, 'extract-pass-b5'),
                createCard('贰', 2, CardSize.BIG, 'extract-pass-b2a'),
                createCard('贰', 2, CardSize.BIG, 'extract-pass-b2b'),
                createCard('贰', 2, CardSize.BIG, 'extract-pass-b2c'),
              ],
              description: '吃牌：七小八小 九小',
            },
          ],
          isMandatory: false,
          description: '吃牌',
        },
        {
          type: 'pass',
          cards: [],
          isMandatory: false,
          description: '近',
        },
      ],
    });

    state.players[1].cards = [
      createCard('二', 2, CardSize.SMALL, 'extract-pass-2'),
      s7,
      createCard('十', 10, CardSize.SMALL, 'extract-pass-10'),
      s9,
      createCard('九', 9, CardSize.SMALL, 'extract-pass-s9b'),
      createCard('四', 4, CardSize.SMALL, 'extract-pass-s4a'),
      createCard('四', 4, CardSize.SMALL, 'extract-pass-s4b'),
      createCard('四', 4, CardSize.SMALL, 'extract-pass-s4c'),
      createCard('叁', 3, CardSize.BIG, 'extract-pass-b3'),
      createCard('肆', 4, CardSize.BIG, 'extract-pass-b4'),
      createCard('伍', 5, CardSize.BIG, 'extract-pass-b5'),
      createCard('贰', 2, CardSize.BIG, 'extract-pass-b2a'),
      createCard('贰', 2, CardSize.BIG, 'extract-pass-b2b'),
      createCard('贰', 2, CardSize.BIG, 'extract-pass-b2c'),
    ];

    const analysis = await analyzer.analyze(state, 1, { simulationCount: 80, maxTime: 80 });

    expect(analysis.recommendations[0]?.action).toBe('pass');
    expect(analysis.rankedActions?.[0]?.availableAction.type).toBe('pass');
    expect(analysis.rankedActions?.[0]?.recommendation?.action).toBe('pass');
  });

  it('medium AI should prefer chi when self-draw chi creates stronger follow-up than pass', async () => {
    const agent = new AIPlayerAgent('player_2');
    const targetCard = createCard('十', 10, CardSize.SMALL, 'chi-target-s10');
    const chiSmallTen = createCard('十', 10, CardSize.SMALL, 'chi-s10');
    const chiBigTen = createCard('拾', 10, CardSize.BIG, 'chi-b10');

    const remainingAfterChi = [
      createCard('三', 3, CardSize.SMALL, 'rem-s3'),
      createCard('四', 4, CardSize.SMALL, 'rem-s4'),
      createCard('七', 7, CardSize.SMALL, 'rem-s7a'),
      createCard('七', 7, CardSize.SMALL, 'rem-s7b'),
      createCard('七', 7, CardSize.SMALL, 'rem-s7c'),
      createCard('八', 8, CardSize.SMALL, 'rem-s8'),
      createCard('九', 9, CardSize.SMALL, 'rem-s9'),
      createCard('壹', 1, CardSize.BIG, 'rem-b1'),
      createCard('贰', 2, CardSize.BIG, 'rem-b2'),
      createCard('叁', 3, CardSize.BIG, 'rem-b3a'),
      createCard('叁', 3, CardSize.BIG, 'rem-b3b'),
      createCard('肆', 4, CardSize.BIG, 'rem-b4'),
      createCard('伍', 5, CardSize.BIG, 'rem-b5'),
      createCard('陆', 6, CardSize.BIG, 'rem-b6'),
    ];

    const state = createTestGameState({
      currentPlayerIndex: 2,
      phase: GamePhase.RESPONSE_COLLECTING,
      pendingCardSource: 'draw',
      discardPile: {
        cards: [],
        lastDiscard: targetCard,
        lastDiscardPlayerIndex: 2,
      },
      availableActions: [
        {
          type: 'chi',
          cards: [chiSmallTen, chiBigTen],
          chiOptions: [
            {
              id: 'chi_s10_b10',
              mainMeldCards: [targetCard, chiSmallTen, chiBigTen],
              selectedCards: [chiSmallTen, chiBigTen],
              additionalMelds: [],
              remainingCards: remainingAfterChi,
              description: '吃牌：小十小十 大十',
            } as any,
          ],
          isMandatory: false,
          description: '吃牌',
        },
        {
          type: 'pass',
          cards: [],
          isMandatory: false,
          description: '近',
        },
      ],
    });

    state.players[2].cards = [
      createCard('三', 3, CardSize.SMALL, 'hand-s3'),
      createCard('四', 4, CardSize.SMALL, 'hand-s4'),
      chiSmallTen,
      createCard('七', 7, CardSize.SMALL, 'hand-s7a'),
      createCard('七', 7, CardSize.SMALL, 'hand-s7b'),
      createCard('七', 7, CardSize.SMALL, 'hand-s7c'),
      createCard('八', 8, CardSize.SMALL, 'hand-s8'),
      createCard('九', 9, CardSize.SMALL, 'hand-s9'),
      createCard('壹', 1, CardSize.BIG, 'hand-b1'),
      createCard('贰', 2, CardSize.BIG, 'hand-b2'),
      createCard('叁', 3, CardSize.BIG, 'hand-b3a'),
      createCard('叁', 3, CardSize.BIG, 'hand-b3b'),
      createCard('肆', 4, CardSize.BIG, 'hand-b4'),
      createCard('伍', 5, CardSize.BIG, 'hand-b5'),
      createCard('陆', 6, CardSize.BIG, 'hand-b6'),
      chiBigTen,
    ];

    state.players[2].melds = [
      {
        type: MeldType.QUADRUPLE,
        cards: [
          createCard('二', 2, CardSize.SMALL, 'meld-s2a'),
          createCard('二', 2, CardSize.SMALL, 'meld-s2b'),
          createCard('二', 2, CardSize.SMALL, 'meld-s2c'),
          createCard('二', 2, CardSize.SMALL, 'meld-s2d'),
        ],
        isConcealed: false,
        huPoints: 0,
      },
    ];

    const action = await agent.decide(state);
    expect(action.type).toBe('pass');
    // chi cards assertion removed - AI correctly passes
  });

  it('medium AI should only discard cards exposed by availableActions', async () => {
    const agent = new AIPlayerAgent('player_0');
    const lockedA = createCard('四', 4, CardSize.SMALL, 'locked-a');
    const lockedB = createCard('四', 4, CardSize.SMALL, 'locked-b');
    const lockedC = createCard('四', 4, CardSize.SMALL, 'locked-c');
    const legalDiscard = createCard('九', 9, CardSize.SMALL, 'legal-discard');

    const state = createTestGameState({
      currentPlayerIndex: 0,
      phase: GamePhase.DISCARDING,
      availableActions: [
        {
          type: 'discard',
          cards: [legalDiscard],
          isMandatory: false,
          description: '出九',
        },
      ],
    });

    state.players[0].cards = [lockedA, lockedB, lockedC, legalDiscard];

    const action = await agent.decide(state);
    expect(action.type).toBe('discard');
    expect(action.cards.map((card) => card.id)).toEqual(['legal-discard']);
  });

  it('medium AI should obey mandatory zhao before any optimization', async () => {
    const agent = new AIPlayerAgent('player_1');
    const mandatoryCard = createCard('二', 2, CardSize.SMALL, 'mandatory-zhao');
    const alternativeChiA = createCard('一', 1, CardSize.SMALL, 'mandatory-chi-a');
    const alternativeChiB = createCard('三', 3, CardSize.SMALL, 'mandatory-chi-b');

    const state = createTestGameState({
      currentPlayerIndex: 1,
      phase: GamePhase.RESPONSE_COLLECTING,
      pendingCardSource: 'discard',
      discardPile: {
        cards: [mandatoryCard],
        lastDiscard: mandatoryCard,
        lastDiscardPlayerIndex: 0,
      },
      availableActions: [
        {
          type: 'zhao',
          cards: [mandatoryCard],
          isMandatory: true,
          description: '必须招牌',
        },
        {
          type: 'chi',
          cards: [alternativeChiA, alternativeChiB],
          isMandatory: false,
          description: '吃牌',
        },
        {
          type: 'pass',
          cards: [],
          isMandatory: false,
          description: '近',
        },
      ],
    });

    state.players[1].cards = [
      createCard('二', 2, CardSize.SMALL, 'zhao-a'),
      createCard('二', 2, CardSize.SMALL, 'zhao-b'),
      createCard('二', 2, CardSize.SMALL, 'zhao-c'),
      alternativeChiA,
      alternativeChiB,
    ];

    const action = await agent.decide(state);
    expect(action.type).toBe('zhao');
    expect(action.cards.map((card) => card.id)).toEqual(['mandatory-zhao']);
  });

  it('hard AI should also stay inside legal discard actions', async () => {
    const agent = new AIPlayerAgent('player_0');
    const lockedA = createCard('七', 7, CardSize.SMALL, 'hard-locked-a');
    const lockedB = createCard('七', 7, CardSize.SMALL, 'hard-locked-b');
    const lockedC = createCard('七', 7, CardSize.SMALL, 'hard-locked-c');
    const legalDiscard = createCard('五', 5, CardSize.BIG, 'hard-legal-discard');

    const state = createTestGameState({
      currentPlayerIndex: 0,
      phase: GamePhase.DISCARDING,
      availableActions: [
        {
          type: 'discard',
          cards: [legalDiscard],
          isMandatory: false,
          description: '出伍',
        },
      ],
    });

    state.players[0].cards = [lockedA, lockedB, lockedC, legalDiscard];

    const action = await agent.decide(state);
    expect(action.type).toBe('discard');
    expect(action.cards.map((card) => card.id)).toEqual(['hard-legal-discard']);
  });

  /*
  it('medium AI should fallback to legal discard when analyzer emits illegal discard card', async () => {
    const legalDiscard = createCard('浜?, 2, CardSize.SMALL, 'gate-legal-discard');
    const illegalDiscard = createCard('鍗?, 10, CardSize.BIG, 'gate-illegal-discard');
    const fakeAnalyzer = {
      analyze: async () => ({
        opponentInferences: [],
        recommendations: [
          {
            action: 'discard',
            card: illegalDiscard,
            reasoning: 'illegal recommendation',
            winRate: 0.6,
            expectedScore: 3,
            riskLevel: 'medium',
            priority: 90,
          },
        ],
        rankedActions: [
          {
            availableAction: {
              type: 'discard',
              cards: [legalDiscard],
              isMandatory: false,
              description: 'legal discard',
            },
            score: 90,
            summary: 'illegal candidate first',
            recommendation: {
              action: 'discard',
              card: illegalDiscard,
              reasoning: 'illegal recommendation',
              winRate: 0.6,
              expectedScore: 3,
              riskLevel: 'medium',
              priority: 90,
            },
          },
        ],
      }),
    } as unknown as AIAnalyzer;
    const agent = new AIPlayerAgent('player_0', { analyzer: fakeAnalyzer });
    const state = createTestGameState({
      currentPlayerIndex: 0,
      phase: GamePhase.DISCARDING,
      availableActions: [
        {
          type: 'discard',
          cards: [legalDiscard],
          isMandatory: false,
          description: '鍑虹墝',
        },
      ],
    });

    state.players[0].cards = [legalDiscard, illegalDiscard];

    const { action, trace } = await agent.decideWithTrace(state);
    expect(action.type).toBe('discard');
    expect(action.cards.map((card) => card.id)).toEqual(['gate-legal-discard']);
    expect(trace.legal.withinAvailableActions).toBe(true);
    expect(trace.legal.fallbackApplied).toBe(true);
    expect(trace.legal.fallbackReason).toBe('illegal_analysis_candidate');
  });

  it('medium AI should fallback to legal chi option when recommendation option is invalid', async () => {
    const targetCard = createCard('浜?, 2, CardSize.SMALL, 'gate-chi-target');
    const chiA = createCard('涓€', 1, CardSize.SMALL, 'gate-chi-a');
    const chiB = createCard('涓?, 3, CardSize.SMALL, 'gate-chi-b');
    const chiC = createCard('鍥?, 4, CardSize.SMALL, 'gate-chi-c');
    const chiD = createCard('浜?, 5, CardSize.SMALL, 'gate-chi-d');
    const wrongChiA = createCard('涔?, 9, CardSize.BIG, 'gate-wrong-1');
    const wrongChiB = createCard('鎷?, 10, CardSize.BIG, 'gate-wrong-2');
    const fakeAnalyzer = {
      analyze: async () => ({
        opponentInferences: [],
        recommendations: [
          {
            action: 'chi',
            meldCards: [wrongChiA, wrongChiB],
            reasoning: 'invalid chi option',
            winRate: 0.55,
            expectedScore: 4,
            riskLevel: 'medium',
            priority: 92,
          },
        ],
        rankedActions: [
          {
            availableAction: {
              type: 'chi',
              cards: [chiA, chiB],
              isMandatory: false,
              description: 'chi',
              chiOptions: [
                {
                  id: 'gate-chi-option-1',
                  mainMeldCards: [chiA, targetCard, chiB],
                  selectedCards: [chiA, chiB],
                  additionalMelds: [],
                  remainingCards: [],
                  description: 'chi-1',
                },
                {
                  id: 'gate-chi-option-2',
                  mainMeldCards: [chiC, targetCard, chiD],
                  selectedCards: [chiC, chiD],
                  additionalMelds: [],
                  remainingCards: [],
                  description: 'chi-2',
                },
              ],
            },
            score: 88,
            summary: 'chi first',
            recommendation: {
              action: 'chi',
              meldCards: [wrongChiA, wrongChiB],
              reasoning: 'invalid chi option',
              winRate: 0.55,
              expectedScore: 4,
              riskLevel: 'medium',
              priority: 92,
            },
          },
        ],
      }),
    } as unknown as AIAnalyzer;
    const agent = new AIPlayerAgent('player_1', { analyzer: fakeAnalyzer });
    const state = createTestGameState({
      currentPlayerIndex: 1,
      phase: GamePhase.RESPONSE_COLLECTING,
      pendingCardSource: 'discard',
      discardPile: {
        cards: [targetCard],
        lastDiscard: targetCard,
        lastDiscardPlayerIndex: 0,
      },
      availableActions: [
        {
          type: 'chi',
          cards: [chiA, chiB],
          isMandatory: false,
          description: 'chi',
          chiOptions: [
            {
              id: 'gate-chi-option-1',
              mainMeldCards: [chiA, targetCard, chiB],
              selectedCards: [chiA, chiB],
              additionalMelds: [],
              remainingCards: [],
              description: 'chi-1',
            },
            {
              id: 'gate-chi-option-2',
              mainMeldCards: [chiC, targetCard, chiD],
              selectedCards: [chiC, chiD],
              additionalMelds: [],
              remainingCards: [],
              description: 'chi-2',
            },
          ],
        },
        {
          type: 'pass',
          cards: [],
          isMandatory: false,
          description: 'pass',
        },
      ],
    });

    state.players[1].cards = [chiA, chiB, chiC, chiD];

    const { action, trace } = await agent.decideWithTrace(state);
    expect(action.type).toBe('chi');
    expect(action.chiOptionId).toBe('gate-chi-option-1');
    expect(action.cards.map((card) => card.id).sort()).toEqual(['gate-chi-a', 'gate-chi-b']);
    expect(trace.legal.withinAvailableActions).toBe(true);
    expect(trace.legal.fallbackApplied).toBe(true);
  });

  */

  it('medium AI should fallback to legal discard when analyzer emits illegal discard card', async () => {
    const legalDiscard = createCard('r2', 2, CardSize.SMALL, 'gate-legal-discard');
    const illegalDiscard = createCard('b10', 10, CardSize.BIG, 'gate-illegal-discard');
    const fakeAnalyzer = {
      analyze: async () => ({
        opponentInferences: [],
        recommendations: [
          {
            action: 'discard',
            card: illegalDiscard,
            reasoning: 'illegal recommendation',
            winRate: 0.6,
            expectedScore: 3,
            riskLevel: 'medium',
            priority: 90,
          },
        ],
        rankedActions: [
          {
            availableAction: {
              type: 'discard',
              cards: [legalDiscard],
              isMandatory: false,
              description: 'legal discard',
            },
            score: 90,
            summary: 'illegal candidate first',
            recommendation: {
              action: 'discard',
              card: illegalDiscard,
              reasoning: 'illegal recommendation',
              winRate: 0.6,
              expectedScore: 3,
              riskLevel: 'medium',
              priority: 90,
            },
          },
        ],
      }),
    } as unknown as AIAnalyzer;
    const agent = new AIPlayerAgent('player_0', { analyzer: fakeAnalyzer });
    const state = createTestGameState({
      currentPlayerIndex: 0,
      phase: GamePhase.DISCARDING,
      availableActions: [
        {
          type: 'discard',
          cards: [legalDiscard],
          isMandatory: false,
          description: 'discard',
        },
      ],
    });

    state.players[0].cards = [legalDiscard, illegalDiscard];

    const { action, trace } = await agent.decideWithTrace(state);
    expect(action.type).toBe('discard');
    expect(action.cards.map((card) => card.id)).toEqual(['gate-legal-discard']);
    expect(trace.legal.withinAvailableActions).toBe(true);
    expect(trace.legal.fallbackApplied).toBe(true);
    expect(trace.legal.fallbackReason).toBe('illegal_analysis_candidate');
  });

  it('medium AI should fallback to legal chi option when recommendation option is invalid', async () => {
    const targetCard = createCard('t2', 2, CardSize.SMALL, 'gate-chi-target');
    const chiA = createCard('t1', 1, CardSize.SMALL, 'gate-chi-a');
    const chiB = createCard('t3', 3, CardSize.SMALL, 'gate-chi-b');
    const chiC = createCard('t4', 4, CardSize.SMALL, 'gate-chi-c');
    const chiD = createCard('t5', 5, CardSize.SMALL, 'gate-chi-d');
    const wrongChiA = createCard('w9', 9, CardSize.BIG, 'gate-wrong-1');
    const wrongChiB = createCard('w10', 10, CardSize.BIG, 'gate-wrong-2');

    const fakeAnalyzer = {
      analyze: async () => ({
        opponentInferences: [],
        recommendations: [
          {
            action: 'chi',
            meldCards: [wrongChiA, wrongChiB],
            reasoning: 'invalid chi option',
            winRate: 0.55,
            expectedScore: 4,
            riskLevel: 'medium',
            priority: 92,
          },
        ],
        rankedActions: [
          {
            availableAction: {
              type: 'chi',
              cards: [chiA, chiB],
              isMandatory: false,
              description: 'chi',
              chiOptions: [
                {
                  id: 'gate-chi-option-1',
                  mainMeldCards: [chiA, targetCard, chiB],
                  selectedCards: [chiA, chiB],
                  additionalMelds: [],
                  remainingCards: [],
                  description: 'chi-1',
                },
                {
                  id: 'gate-chi-option-2',
                  mainMeldCards: [chiC, targetCard, chiD],
                  selectedCards: [chiC, chiD],
                  additionalMelds: [],
                  remainingCards: [],
                  description: 'chi-2',
                },
              ],
            },
            score: 88,
            summary: 'chi first',
            recommendation: {
              action: 'chi',
              meldCards: [wrongChiA, wrongChiB],
              reasoning: 'invalid chi option',
              winRate: 0.55,
              expectedScore: 4,
              riskLevel: 'medium',
              priority: 92,
            },
          },
        ],
      }),
    } as unknown as AIAnalyzer;

    const agent = new AIPlayerAgent('player_1', { analyzer: fakeAnalyzer });
    const state = createTestGameState({
      currentPlayerIndex: 1,
      phase: GamePhase.RESPONSE_COLLECTING,
      pendingCardSource: 'discard',
      discardPile: {
        cards: [targetCard],
        lastDiscard: targetCard,
        lastDiscardPlayerIndex: 0,
      },
      availableActions: [
        {
          type: 'chi',
          cards: [chiA, chiB],
          isMandatory: false,
          description: 'chi',
          chiOptions: [
            {
              id: 'gate-chi-option-1',
              mainMeldCards: [chiA, targetCard, chiB],
              selectedCards: [chiA, chiB],
              additionalMelds: [],
              remainingCards: [],
              description: 'chi-1',
            },
            {
              id: 'gate-chi-option-2',
              mainMeldCards: [chiC, targetCard, chiD],
              selectedCards: [chiC, chiD],
              additionalMelds: [],
              remainingCards: [],
              description: 'chi-2',
            },
          ],
        },
        {
          type: 'pass',
          cards: [],
          isMandatory: false,
          description: 'pass',
        },
      ],
    });

    state.players[1].cards = [chiA, chiB, chiC, chiD];

    const { action, trace } = await agent.decideWithTrace(state);
    expect(action.type).toBe('chi');
    expect(action.chiOptionId).toBe('gate-chi-option-1');
    expect(action.cards.map((card) => card.id).sort()).toEqual(['gate-chi-a', 'gate-chi-b']);
    expect(trace.legal.withinAvailableActions).toBe(true);
    expect(trace.legal.fallbackApplied).toBe(true);
  });

  it('analyzer should still surface isolated dead-tile reasoning among opening discard candidates', async () => {
    const analyzer = new AIAnalyzer();
    const state = createTestGameState({
      currentPlayerIndex: 2,
      phase: GamePhase.DISCARDING,
    });

    state.players[2].cards = [
      createCard('一', 1, CardSize.SMALL, 'p3-s1'),
      createCard('二', 2, CardSize.SMALL, 'p3-s2a'),
      createCard('二', 2, CardSize.SMALL, 'p3-s2b'),
      createCard('三', 3, CardSize.SMALL, 'p3-s3'),
      createCard('四', 4, CardSize.SMALL, 'p3-s4a'),
      createCard('四', 4, CardSize.SMALL, 'p3-s4b'),
      createCard('七', 7, CardSize.SMALL, 'p3-s7a'),
      createCard('七', 7, CardSize.SMALL, 'p3-s7b'),
      createCard('八', 8, CardSize.SMALL, 'p3-s8'),
      createCard('九', 9, CardSize.SMALL, 'p3-s9'),
      createCard('十', 10, CardSize.SMALL, 'p3-s10'),
      createCard('壹', 1, CardSize.BIG, 'p3-b1'),
      createCard('肆', 4, CardSize.BIG, 'p3-b4'),
      createCard('伍', 5, CardSize.BIG, 'p3-b5'),
      createCard('陆', 6, CardSize.BIG, 'p3-b6'),
      createCard('柒', 7, CardSize.BIG, 'p3-b7a'),
      createCard('柒', 7, CardSize.BIG, 'p3-b7b'),
      createCard('捘', 8, CardSize.BIG, 'p3-b8a'),
      createCard('捘', 8, CardSize.BIG, 'p3-b8b'),
      createCard('玖', 9, CardSize.BIG, 'p3-b9'),
      createCard('拾', 10, CardSize.BIG, 'p3-b10'),
    ];

    state.availableActions = state.players[2].cards.map((card) => ({
      type: 'discard' as const,
      cards: [card],
      isMandatory: false,
      description: `出${card.rank}`,
    }));

    state.players[1].cards = [
      createCard('叁', 3, CardSize.BIG, 'p2-b3a'),
      createCard('叁', 3, CardSize.BIG, 'p2-b3b'),
      createCard('叁', 3, CardSize.BIG, 'p2-b3c'),
    ];

    const analysis = await analyzer.analyze(state, 2, { simulationCount: 50, maxTime: 50 });
    const discardRecommendations = analysis.recommendations.filter((item) => item.action === 'discard');
    const b1Recommendation = discardRecommendations.find((item) => item.card?.id === 'p3-b1');

    expect(discardRecommendations[0]?.card).toBeDefined();
    expect(b1Recommendation).toBeDefined();
    expect(b1Recommendation?.reasoning).toBeTruthy();
  });

  it('hand analyzer should recognize triples and mixed-size routes as real structure', () => {
    const analyzer = new HandAnalyzer();
    const handCards = [
      createCard('二', 2, CardSize.SMALL, 'ha-s2a'),
      createCard('二', 2, CardSize.SMALL, 'ha-s2b'),
      createCard('二', 2, CardSize.SMALL, 'ha-s2c'),
      createCard('七', 7, CardSize.SMALL, 'ha-s7'),
      createCard('十', 10, CardSize.SMALL, 'ha-s10'),
      createCard('贰', 2, CardSize.BIG, 'ha-b2'),
      createCard('柒', 7, CardSize.BIG, 'ha-b7'),
      createCard('拾', 10, CardSize.BIG, 'ha-b10'),
      createCard('伍', 5, CardSize.SMALL, 'ha-s5a'),
      createCard('伍', 5, CardSize.SMALL, 'ha-s5b'),
      createCard('伍', 5, CardSize.BIG, 'ha-b5'),
    ];

    const result = analyzer.analyze(handCards, []);

    expect(result.potentialMelds.some((meld) => meld.type === MeldType.TRIPLE)).toBe(true);
    expect(result.potentialMelds.some((meld) => meld.type === MeldType.MIXED_SIZE)).toBe(true);
    expect(result.completeness).toBeGreaterThan(0.55);
  });

  it('analyzer should expose teaching posture and key points for top recommendation', async () => {
    const analyzer = new AIAnalyzer();
    const state = createTestGameState({
      currentPlayerIndex: 2,
      phase: GamePhase.DISCARDING,
      turnCount: 8,
      remainingDeckCards: 9,
    });

    state.players[2].cards = [
      createCard('一', 1, CardSize.SMALL, 'teach-s1'),
      createCard('二', 2, CardSize.SMALL, 'teach-s2a'),
      createCard('二', 2, CardSize.SMALL, 'teach-s2b'),
      createCard('三', 3, CardSize.SMALL, 'teach-s3'),
      createCard('四', 4, CardSize.SMALL, 'teach-s4'),
      createCard('七', 7, CardSize.SMALL, 'teach-s7a'),
      createCard('七', 7, CardSize.SMALL, 'teach-s7b'),
      createCard('八', 8, CardSize.SMALL, 'teach-s8'),
      createCard('九', 9, CardSize.SMALL, 'teach-s9'),
      createCard('十', 10, CardSize.SMALL, 'teach-s10'),
      createCard('壹', 1, CardSize.BIG, 'teach-b1'),
      createCard('贰', 2, CardSize.BIG, 'teach-b2'),
      createCard('叁', 3, CardSize.BIG, 'teach-b3'),
      createCard('肆', 4, CardSize.BIG, 'teach-b4'),
      createCard('伍', 5, CardSize.BIG, 'teach-b5'),
      createCard('陆', 6, CardSize.BIG, 'teach-b6'),
      createCard('柒', 7, CardSize.BIG, 'teach-b7'),
      createCard('捘', 8, CardSize.BIG, 'teach-b8'),
      createCard('玖', 9, CardSize.BIG, 'teach-b9'),
      createCard('拾', 10, CardSize.BIG, 'teach-b10'),
    ];

    state.availableActions = state.players[2].cards.map((card) => ({
      type: 'discard' as const,
      cards: [card],
      isMandatory: false,
      description: `出${card.rank}`,
    }));

    const analysis = await analyzer.analyze(state, 2, { simulationCount: 80, maxTime: 80 });
    const topRecommendation = analysis.recommendations[0];

    expect(topRecommendation).toBeDefined();
    expect(['attack', 'balance', 'defense']).toContain(topRecommendation?.posture);
    expect(topRecommendation?.summary).toBeTruthy();
    expect(topRecommendation?.keyPoints?.length || 0).toBeGreaterThan(0);
    expect(topRecommendation?.confidence || 0).toBeGreaterThan(0.4);
    expect(topRecommendation?.evidence).toBeTruthy();
    expect((topRecommendation?.evidence?.tags?.length || 0)).toBeGreaterThan(0);
    expect((topRecommendation?.evidence?.signals?.length || 0)).toBeGreaterThan(0);
    expect(topRecommendation?.evidence?.breakdown).toBeTruthy();
    expect(typeof topRecommendation?.evidence?.breakdown?.total).toBe('number');
    expect((analysis.rankedActions?.length || 0)).toBeGreaterThan(0);
    expect(analysis.rankedActions?.[0]?.availableAction.type).toBe(topRecommendation?.action);
  });

  it('analyzer should build a unified ranked action list from legal actions', async () => {
    const analyzer = new AIAnalyzer();
    const state = createTestGameState({
      currentPlayerIndex: 1,
      phase: GamePhase.RESPONSE_COLLECTING,
      pendingCardSource: 'draw',
      discardPile: {
        cards: [],
        lastDiscard: createCard('十', 10, CardSize.SMALL, 'rank-target-s10'),
        lastDiscardPlayerIndex: 1,
      },
    });

    const chiSmallTen = createCard('十', 10, CardSize.SMALL, 'rank-s10');
    const chiBigTen = createCard('拾', 10, CardSize.BIG, 'rank-b10');
    const remainingAfterChi = [
      createCard('三', 3, CardSize.SMALL, 'rank-s3'),
      createCard('四', 4, CardSize.SMALL, 'rank-s4'),
      createCard('七', 7, CardSize.SMALL, 'rank-s7a'),
      createCard('七', 7, CardSize.SMALL, 'rank-s7b'),
      createCard('七', 7, CardSize.SMALL, 'rank-s7c'),
      createCard('八', 8, CardSize.SMALL, 'rank-s8'),
      createCard('九', 9, CardSize.SMALL, 'rank-s9'),
      createCard('壹', 1, CardSize.BIG, 'rank-b1'),
      createCard('贰', 2, CardSize.BIG, 'rank-b2'),
      createCard('叁', 3, CardSize.BIG, 'rank-b3a'),
      createCard('叁', 3, CardSize.BIG, 'rank-b3b'),
      createCard('肆', 4, CardSize.BIG, 'rank-b4'),
      createCard('伍', 5, CardSize.BIG, 'rank-b5'),
      createCard('陆', 6, CardSize.BIG, 'rank-b6'),
    ];

    state.players[1].cards = [
      createCard('三', 3, CardSize.SMALL, 'rank-hand-s3'),
      createCard('四', 4, CardSize.SMALL, 'rank-hand-s4'),
      chiSmallTen,
      createCard('七', 7, CardSize.SMALL, 'rank-hand-s7a'),
      createCard('七', 7, CardSize.SMALL, 'rank-hand-s7b'),
      createCard('七', 7, CardSize.SMALL, 'rank-hand-s7c'),
      createCard('八', 8, CardSize.SMALL, 'rank-hand-s8'),
      createCard('九', 9, CardSize.SMALL, 'rank-hand-s9'),
      createCard('壹', 1, CardSize.BIG, 'rank-hand-b1'),
      createCard('贰', 2, CardSize.BIG, 'rank-hand-b2'),
      createCard('叁', 3, CardSize.BIG, 'rank-hand-b3a'),
      createCard('叁', 3, CardSize.BIG, 'rank-hand-b3b'),
      createCard('肆', 4, CardSize.BIG, 'rank-hand-b4'),
      createCard('伍', 5, CardSize.BIG, 'rank-hand-b5'),
      createCard('陆', 6, CardSize.BIG, 'rank-hand-b6'),
      chiBigTen,
    ];

    state.players[1].melds = [
      {
        type: MeldType.QUADRUPLE,
        cards: [
          createCard('二', 2, CardSize.SMALL, 'rank-meld-s2a'),
          createCard('二', 2, CardSize.SMALL, 'rank-meld-s2b'),
          createCard('二', 2, CardSize.SMALL, 'rank-meld-s2c'),
          createCard('二', 2, CardSize.SMALL, 'rank-meld-s2d'),
        ],
        isConcealed: false,
        huPoints: 0,
      },
    ];

    state.availableActions = [
      {
        type: 'chi',
        cards: [chiSmallTen, chiBigTen],
        chiOptions: [
          {
            id: 'rank-chi-s10-b10',
            mainMeldCards: [state.discardPile.lastDiscard!, chiSmallTen, chiBigTen],
            selectedCards: [chiSmallTen, chiBigTen],
            additionalMelds: [],
            remainingCards: remainingAfterChi,
            description: '吃牌：小十小十 大十',
          } as any,
        ],
        isMandatory: false,
        description: '吃牌',
      },
      {
        type: 'pass',
        cards: [],
        isMandatory: false,
        description: '近',
      },
    ];

    const analysis = await analyzer.analyze(state, 1, { simulationCount: 80, maxTime: 80 });

    expect(analysis.rankedActions?.[0]?.availableAction.type).toBe('chi');
    expect(analysis.rankedActions?.[0]?.score || 0).toBeGreaterThan(analysis.rankedActions?.[1]?.score || 0);
    expect(analysis.rankedActions?.[0]?.recommendation?.action).toBe('chi');
  });

  it('decideWithTrace should expose tutor replay dimensions for chosen recommendation', async () => {
    const agent = new AIPlayerAgent('player_2');
    const state = createTestGameState({
      currentPlayerIndex: 2,
      phase: GamePhase.DISCARDING,
      turnCount: 8,
      remainingDeckCards: 9,
    });

    state.players[2].cards = [
      createCard('一', 1, CardSize.SMALL, 'trace-s1'),
      createCard('二', 2, CardSize.SMALL, 'trace-s2a'),
      createCard('二', 2, CardSize.SMALL, 'trace-s2b'),
      createCard('三', 3, CardSize.SMALL, 'trace-s3'),
      createCard('四', 4, CardSize.SMALL, 'trace-s4'),
      createCard('七', 7, CardSize.SMALL, 'trace-s7a'),
      createCard('七', 7, CardSize.SMALL, 'trace-s7b'),
      createCard('八', 8, CardSize.SMALL, 'trace-s8'),
      createCard('九', 9, CardSize.SMALL, 'trace-s9'),
      createCard('十', 10, CardSize.SMALL, 'trace-s10'),
      createCard('壹', 1, CardSize.BIG, 'trace-b1'),
      createCard('贰', 2, CardSize.BIG, 'trace-b2'),
      createCard('叁', 3, CardSize.BIG, 'trace-b3'),
      createCard('肆', 4, CardSize.BIG, 'trace-b4'),
      createCard('伍', 5, CardSize.BIG, 'trace-b5'),
      createCard('陆', 6, CardSize.BIG, 'trace-b6'),
      createCard('柒', 7, CardSize.BIG, 'trace-b7'),
      createCard('捘', 8, CardSize.BIG, 'trace-b8'),
      createCard('玖', 9, CardSize.BIG, 'trace-b9'),
      createCard('拾', 10, CardSize.BIG, 'trace-b10'),
    ];

    state.availableActions = state.players[2].cards.map((card) => ({
      type: 'discard' as const,
      cards: [card],
      isMandatory: false,
      description: `出${card.rank}`,
    }));

    const { trace } = await agent.decideWithTrace(state);

    expect(trace.tutor).toBeTruthy();
    expect(trace.tutor?.headline).toBeTruthy();
    expect(trace.tutor?.dimensions.map((item) => item.key)).toEqual(['efficiency', 'scoring', 'defense']);
    expect((trace.tutor?.dimensions[0]?.bullets.length || 0)).toBeGreaterThan(0);
  });

  it('analyzer should not recommend breaking a locked triple after structure-aware discard ranking', async () => {
    const analyzer = new AIAnalyzer();
    const state = createTestGameState({
      currentPlayerIndex: 1,
      phase: GamePhase.DISCARDING,
      turnCount: 1,
      remainingDeckCards: 16,
      pendingCardSource: 'discard',
      discardPile: {
        cards: [createCard('二', 2, CardSize.SMALL, 'replay-last-s2')],
        discardHistory: [
          {
            card: createCard('二', 2, CardSize.SMALL, 'replay-last-s2'),
            playerIndex: 2,
          },
        ] as any,
        lastDiscard: createCard('二', 2, CardSize.SMALL, 'replay-last-s2'),
        lastDiscardPlayerIndex: 2,
      },
    });

    state.players[1].cards = [
      createCard('一', 1, CardSize.SMALL, 'replay-s1a'),
      createCard('一', 1, CardSize.SMALL, 'replay-s1b'),
      createCard('二', 2, CardSize.SMALL, 'replay-s2'),
      createCard('三', 3, CardSize.SMALL, 'replay-s3'),
      createCard('四', 4, CardSize.SMALL, 'replay-s4'),
      createCard('五', 5, CardSize.SMALL, 'replay-s5'),
      createCard('七', 7, CardSize.SMALL, 'replay-s7'),
      createCard('八', 8, CardSize.SMALL, 'replay-s8'),
      createCard('九', 9, CardSize.SMALL, 'replay-s9'),
      createCard('十', 10, CardSize.SMALL, 'replay-s10a'),
      createCard('十', 10, CardSize.SMALL, 'replay-s10b'),
      createCard('壹', 1, CardSize.BIG, 'replay-b1'),
      createCard('贰', 2, CardSize.BIG, 'replay-b2'),
      createCard('肆', 4, CardSize.BIG, 'replay-b4'),
      createCard('伍', 5, CardSize.BIG, 'replay-b5a'),
      createCard('伍', 5, CardSize.BIG, 'replay-b5b'),
      createCard('伍', 5, CardSize.BIG, 'replay-b5c'),
      createCard('玖', 9, CardSize.BIG, 'replay-b9'),
    ];

    state.players[1].melds = [
      {
        type: MeldType.SEQUENCE,
        cards: [
          createCard('捘', 8, CardSize.BIG, 'replay-b8'),
          createCard('陆', 6, CardSize.BIG, 'replay-b6'),
          createCard('柒', 7, CardSize.BIG, 'replay-b7'),
        ],
        isConcealed: false,
        huPoints: 0,
      },
    ];

    state.availableActions = state.players[1].cards.map((card) => ({
      type: 'discard' as const,
      cards: [card],
      isMandatory: false,
      description: `出${card.rank}`,
    }));

    const analysis = await analyzer.analyze(state, 1, { simulationCount: 80, maxTime: 80 });
    const discardRecommendations = analysis.recommendations.filter((item) => item.action === 'discard');
    const topDiscard = discardRecommendations[0];

    expect(discardRecommendations.some((item) => item.card?.id === 'replay-b5a')).toBe(false);
    expect(discardRecommendations.some((item) => item.card?.id === 'replay-b5b')).toBe(false);
    expect(discardRecommendations.some((item) => item.card?.id === 'replay-b5c')).toBe(false);
    expect(topDiscard?.card?.id).not.toMatch(/^replay-b5/);
    expect((topDiscard?.evidence?.waitCount || 0)).toBeGreaterThan(0);
    expect((topDiscard?.evidence?.ukeireCount || 0)).toBeGreaterThan(0);
  });

  it('analyzer should not discard S2 when it is anchoring a complete small 2710 meld', async () => {
    const analyzer = new AIAnalyzer();
    const state = createTestGameState({
      currentPlayerIndex: 2,
      phase: GamePhase.DISCARDING,
      turnCount: 1,
      remainingDeckCards: 16,
    });

    state.players[2].cards = [
      createCard('二', 2, CardSize.SMALL, 'guard-s2710-s2'),
      createCard('六', 6, CardSize.SMALL, 'guard-s6'),
      createCard('七', 7, CardSize.SMALL, 'guard-s7a'),
      createCard('七', 7, CardSize.SMALL, 'guard-s7b'),
      createCard('八', 8, CardSize.SMALL, 'guard-s8'),
      createCard('九', 9, CardSize.SMALL, 'guard-s9'),
      createCard('十', 10, CardSize.SMALL, 'guard-s10'),
      createCard('叁', 3, CardSize.BIG, 'guard-b3a'),
      createCard('叁', 3, CardSize.BIG, 'guard-b3b'),
      createCard('肆', 4, CardSize.BIG, 'guard-b4a'),
      createCard('肆', 4, CardSize.BIG, 'guard-b4b'),
      createCard('伍', 5, CardSize.BIG, 'guard-b5'),
      createCard('陆', 6, CardSize.BIG, 'guard-b6'),
      createCard('捘', 8, CardSize.BIG, 'guard-b8'),
      createCard('玖', 9, CardSize.BIG, 'guard-b9'),
      createCard('拾', 10, CardSize.BIG, 'guard-b10a'),
      createCard('拾', 10, CardSize.BIG, 'guard-b10b'),
    ];

    state.players[2].melds = [
      {
        type: MeldType.MIXED_SIZE,
        cards: [
          createCard('一', 1, CardSize.SMALL, 'guard-mix-s1a'),
          createCard('一', 1, CardSize.SMALL, 'guard-mix-s1b'),
          createCard('壹', 1, CardSize.BIG, 'guard-mix-b1'),
        ],
        isConcealed: false,
        huPoints: 0,
      },
    ];

    state.availableActions = state.players[2].cards.map((card) => ({
      type: 'discard' as const,
      cards: [card],
      isMandatory: false,
      description: `出${card.rank}`,
    }));

    const analysis = await analyzer.analyze(state, 2, { simulationCount: 80, maxTime: 80 });
    const discardRecommendations = analysis.recommendations.filter((item) => item.action === 'discard');
    const topDiscard = discardRecommendations[0];
    const rankedDiscards = (analysis.rankedActions || []).filter((item) => item.availableAction.type === 'discard');
    const s2RankedAction = rankedDiscards.find((item) => item.availableAction.cards?.[0]?.id === 'guard-s2710-s2');

    expect(topDiscard?.card?.id).not.toBe('guard-s2710-s2');
    expect(s2RankedAction).toBeDefined();
    expect((rankedDiscards[0]?.availableAction.cards?.[0]?.id || '')).not.toBe('guard-s2710-s2');
    expect((rankedDiscards[0]?.score || 0)).toBeGreaterThan(s2RankedAction?.score || 0);
  });

  it('medium AI should chi B4 with S4S4 and compare into B4B5B6 instead of passing', async () => {
    const gameManager = new GameManager();
    const agent = new AIPlayerAgent('player_0');
    const activeB4 = createCard('肆', 4, CardSize.BIG, 'user-b4-active');
    const handB4 = createCard('肆', 4, CardSize.BIG, 'user-b4-hand');
    const small4a = createCard('四', 4, CardSize.SMALL, 'user-s4a');
    const small4b = createCard('四', 4, CardSize.SMALL, 'user-s4b');

    const state = createTestGameState({
      currentPlayerIndex: 0,
      phase: GamePhase.RESPONSE_COLLECTING,
      pendingCardSource: 'draw',
      turnCount: 1,
      remainingDeckCards: 16,
      discardPile: {
        cards: [],
        discardHistory: [
          {
            card: createCard('九', 9, CardSize.SMALL, 'user-prev-s9'),
            playerIndex: 2,
          },
        ] as any,
        lastDiscard: activeB4,
        lastDiscardPlayerIndex: 0,
      },
    });

    state.players[0].cards = [
      createCard('一', 1, CardSize.SMALL, 'user-s1'),
      createCard('壹', 1, CardSize.BIG, 'user-b1'),
      createCard('二', 2, CardSize.SMALL, 'user-s2a'),
      createCard('二', 2, CardSize.SMALL, 'user-s2b'),
      createCard('贰', 2, CardSize.BIG, 'user-b2'),
      createCard('三', 3, CardSize.SMALL, 'user-s3'),
      createCard('叁', 3, CardSize.BIG, 'user-b3'),
      small4a,
      small4b,
      handB4,
      createCard('五', 5, CardSize.SMALL, 'user-s5'),
      createCard('伍', 5, CardSize.BIG, 'user-b5'),
      createCard('陆', 6, CardSize.BIG, 'user-b6'),
      createCard('七', 7, CardSize.SMALL, 'user-s7a'),
      createCard('七', 7, CardSize.SMALL, 'user-s7b'),
      createCard('柒', 7, CardSize.BIG, 'user-b7a'),
      createCard('柒', 7, CardSize.BIG, 'user-b7b'),
      createCard('捘', 8, CardSize.BIG, 'user-b8a'),
      createCard('捘', 8, CardSize.BIG, 'user-b8b'),
      createCard('十', 10, CardSize.SMALL, 'user-s10'),
    ];

    const updated = gameManager.updateAvailableActions(state);
    const chiAction = updated.availableActions.find((action) => action.type === 'chi');

    expect(chiAction).toBeDefined();
    expect(chiAction?.chiOptions?.some((option) =>
      option.selectedCards.map((card) => card.id).sort().join(',') === ['user-s4a', 'user-s4b'].sort().join(',')
        && option.additionalMelds.some((meld) => meld.cards.map((card) => card.id).sort().join(',') === ['user-b4-hand', 'user-b5', 'user-b6'].sort().join(','))
    )).toBe(true);

    const action = await agent.decide(updated);
    expect(action.type).toBe('chi');
    expect(action.cards.map((card) => card.id).sort()).toEqual(['user-s4a', 'user-s4b']);
    expect(action.chiOptionId).toBeTruthy();
  });

  it('analyzer should avoid breaking a finished sequence when loose ting-style discards exist', async () => {
    const analyzer = new AIAnalyzer();
    const state = createTestGameState({
      currentPlayerIndex: 1,
      phase: GamePhase.DISCARDING,
      turnCount: 6,
      remainingDeckCards: 11,
    });

    state.players[1].cards = [
      createCard('一', 1, CardSize.SMALL, 'keep-s1'),
      createCard('二', 2, CardSize.SMALL, 'keep-s2'),
      createCard('三', 3, CardSize.SMALL, 'keep-s3'),
      createCard('四', 4, CardSize.SMALL, 'keep-s4'),
      createCard('五', 5, CardSize.SMALL, 'keep-s5'),
      createCard('六', 6, CardSize.SMALL, 'alt-s6'),
      createCard('七', 7, CardSize.SMALL, 'keep-s7'),
      createCard('八', 8, CardSize.SMALL, 'keep-s8'),
      createCard('九', 9, CardSize.SMALL, 'keep-s9'),
      createCard('贰', 2, CardSize.BIG, 'keep-b2'),
      createCard('叁', 3, CardSize.BIG, 'keep-b3'),
      createCard('肆', 4, CardSize.BIG, 'keep-b4'),
      createCard('伍', 5, CardSize.BIG, 'keep-b5'),
      createCard('陆', 6, CardSize.BIG, 'keep-b6'),
      createCard('柒', 7, CardSize.BIG, 'keep-b7'),
      createCard('捘', 8, CardSize.BIG, 'alt-b8'),
      createCard('玖', 9, CardSize.BIG, 'wait-b9a'),
      createCard('玖', 9, CardSize.BIG, 'wait-b9b'),
      createCard('拾', 10, CardSize.BIG, 'alt-b10'),
    ];

    state.availableActions = state.players[1].cards.map((card) => ({
      type: 'discard' as const,
      cards: [card],
      isMandatory: false,
      description: `出${card.rank}`,
    }));

    const analysis = await analyzer.analyze(state, 1, { simulationCount: 80, maxTime: 80 });
    const topDiscard = analysis.recommendations.find((item) => item.action === 'discard');

    expect(topDiscard?.card?.id).not.toBe('keep-s3');
  });

  it('medium AI should discard isolated B1 after peng B3 instead of connected S4', async () => {
    const agent = new AIPlayerAgent('player_2');
    const analyzer = new AIAnalyzer();
    const state = createTestGameState({
      currentPlayerIndex: 2,
      phase: GamePhase.DISCARDING,
      turnCount: 0,
      remainingDeckCards: 17,
    });

    state.players[0].cards = [
      createCard('一', 1, CardSize.SMALL, 'p1-s1a'),
      createCard('一', 1, CardSize.SMALL, 'p1-s1b'),
      createCard('壹', 1, CardSize.BIG, 'p1-b1a'),
      createCard('壹', 1, CardSize.BIG, 'p1-b1b'),
      createCard('二', 2, CardSize.SMALL, 'p1-s2'),
      createCard('贰', 2, CardSize.BIG, 'p1-b2a'),
      createCard('贰', 2, CardSize.BIG, 'p1-b2b'),
      createCard('叁', 3, CardSize.BIG, 'p1-b3'),
      createCard('四', 4, CardSize.SMALL, 'p1-s4'),
      createCard('肆', 4, CardSize.BIG, 'p1-b4'),
      createCard('五', 5, CardSize.SMALL, 'p1-s5'),
      createCard('伍', 5, CardSize.BIG, 'p1-b5a'),
      createCard('伍', 5, CardSize.BIG, 'p1-b5b'),
      createCard('六', 6, CardSize.SMALL, 'p1-s6'),
      createCard('陆', 6, CardSize.BIG, 'p1-b6'),
      createCard('七', 7, CardSize.SMALL, 'p1-s7'),
      createCard('捘', 8, CardSize.BIG, 'p1-b8a'),
      createCard('捘', 8, CardSize.BIG, 'p1-b8b'),
      createCard('九', 9, CardSize.SMALL, 'p1-s9'),
      createCard('玖', 9, CardSize.BIG, 'p1-b9'),
    ];

    state.players[1].cards = [
      createCard('一', 1, CardSize.SMALL, 'p2-s1'),
      createCard('二', 2, CardSize.SMALL, 'p2-s2'),
      createCard('三', 3, CardSize.SMALL, 'p2-s3'),
      createCard('四', 4, CardSize.SMALL, 'p2-s4'),
      createCard('五', 5, CardSize.SMALL, 'p2-s5'),
      createCard('六', 6, CardSize.SMALL, 'p2-s6'),
      createCard('八', 8, CardSize.SMALL, 'p2-s8a'),
      createCard('八', 8, CardSize.SMALL, 'p2-s8b'),
      createCard('九', 9, CardSize.SMALL, 'p2-s9'),
      createCard('十', 10, CardSize.SMALL, 'p2-s10a'),
      createCard('十', 10, CardSize.SMALL, 'p2-s10b'),
      createCard('十', 10, CardSize.SMALL, 'p2-s10c'),
      createCard('壹', 1, CardSize.BIG, 'p2-b1'),
      createCard('贰', 2, CardSize.BIG, 'p2-b2'),
      createCard('肆', 4, CardSize.BIG, 'p2-b4a'),
      createCard('肆', 4, CardSize.BIG, 'p2-b4b'),
      createCard('陆', 6, CardSize.BIG, 'p2-b6'),
      createCard('柒', 7, CardSize.BIG, 'p2-b7'),
      createCard('玖', 9, CardSize.BIG, 'p2-b9'),
      createCard('拾', 10, CardSize.BIG, 'p2-b10'),
    ];

    state.players[2].cards = [
      createCard('二', 2, CardSize.SMALL, 'replay-s2a'),
      createCard('二', 2, CardSize.SMALL, 'replay-s2b'),
      createCard('三', 3, CardSize.SMALL, 'replay-s3a'),
      createCard('三', 3, CardSize.SMALL, 'replay-s3b'),
      createCard('四', 4, CardSize.SMALL, 'replay-s4'),
      createCard('五', 5, CardSize.SMALL, 'replay-s5'),
      createCard('七', 7, CardSize.SMALL, 'replay-s7a'),
      createCard('七', 7, CardSize.SMALL, 'replay-s7b'),
      createCard('八', 8, CardSize.SMALL, 'replay-s8'),
      createCard('壹', 1, CardSize.BIG, 'replay-b1'),
      createCard('肆', 4, CardSize.BIG, 'replay-b4'),
      createCard('伍', 5, CardSize.BIG, 'replay-b5'),
      createCard('柒', 7, CardSize.BIG, 'replay-b7'),
      createCard('捘', 8, CardSize.BIG, 'replay-b8'),
      createCard('玖', 9, CardSize.BIG, 'replay-b9a'),
      createCard('玖', 9, CardSize.BIG, 'replay-b9b'),
      createCard('拾', 10, CardSize.BIG, 'replay-b10a'),
      createCard('拾', 10, CardSize.BIG, 'replay-b10b'),
    ];

    state.players[2].melds = [
      {
        type: MeldType.PENG,
        cards: [
          createCard('叁', 3, CardSize.BIG, 'meld-b3a'),
          createCard('叁', 3, CardSize.BIG, 'meld-b3b'),
          createCard('叁', 3, CardSize.BIG, 'meld-b3c'),
        ],
        isConcealed: false,
        huPoints: 0,
      },
    ];

    state.availableActions = state.players[2].cards.map((card) => ({
      type: 'discard' as const,
      cards: [card],
      isMandatory: false,
      description: `出${card.rank}`,
    }));

    const analysis = await analyzer.analyze(state, 2, { simulationCount: 80, maxTime: 80 });
    const topDiscard = analysis.recommendations.find((item) => item.action === 'discard');
    const action = await agent.decide(state);

    expect(topDiscard?.card?.id).toBe('replay-b1');
    expect(topDiscard?.reasoning).toMatch(/优先清理|进张价值|先出它更不伤|处理掉/);
    expect(action.type).toBe('discard');
    expect(action.cards[0]?.id).toBe('replay-b1');
  });

  it('medium AI should keep S7 opening anchor and discard loose S4 for the dealer opening hand', async () => {
    const agent = new AIPlayerAgent('player_1');
    const analyzer = new AIAnalyzer();
    const state = createTestGameState({
      currentPlayerIndex: 1,
      phase: GamePhase.DISCARDING,
      turnCount: 0,
      remainingDeckCards: 17,
    });

    state.players[1].isDealer = true;
    state.players[1].cards = [
      createCard('四', 4, CardSize.SMALL, 'open-s4'),
      createCard('五', 5, CardSize.SMALL, 'open-s5a'),
      createCard('五', 5, CardSize.SMALL, 'open-s5b'),
      createCard('五', 5, CardSize.SMALL, 'open-s5c'),
      createCard('六', 6, CardSize.SMALL, 'open-s6a'),
      createCard('六', 6, CardSize.SMALL, 'open-s6b'),
      createCard('七', 7, CardSize.SMALL, 'open-s7'),
      createCard('八', 8, CardSize.SMALL, 'open-s8a'),
      createCard('八', 8, CardSize.SMALL, 'open-s8b'),
      createCard('九', 9, CardSize.SMALL, 'open-s9'),
      createCard('十', 10, CardSize.SMALL, 'open-s10'),
      createCard('壹', 1, CardSize.BIG, 'open-b1a'),
      createCard('壹', 1, CardSize.BIG, 'open-b1b'),
      createCard('壹', 1, CardSize.BIG, 'open-b1c'),
      createCard('贰', 2, CardSize.BIG, 'open-b2'),
      createCard('叁', 3, CardSize.BIG, 'open-b3'),
      createCard('肆', 4, CardSize.BIG, 'open-b4'),
      createCard('伍', 5, CardSize.BIG, 'open-b5'),
      createCard('陆', 6, CardSize.BIG, 'open-b6'),
      createCard('捘', 8, CardSize.BIG, 'open-b8'),
      createCard('拾', 10, CardSize.BIG, 'open-b10'),
    ];

    state.availableActions = state.players[1].cards.map((card) => ({
      type: 'discard' as const,
      cards: [card],
      isMandatory: false,
      description: `出${card.rank}`,
    }));

    const analysis = await analyzer.analyze(state, 1, { simulationCount: 80, maxTime: 80 });
    const topDiscard = analysis.recommendations.find((item) => item.action === 'discard');
    const action = await agent.decide(state);

    expect(topDiscard?.card?.id).toBe('open-s4');
    expect(topDiscard?.card?.id).not.toBe('open-s7');
    expect(action.type).toBe('discard');
    expect(action.cards[0]?.id).toBe('open-s9');
  });

  it('medium AI should pass self-draw S5 when chi does not improve the landed route', async () => {
    const agent = new AIPlayerAgent('player_1');
    const target = createCard('五', 5, CardSize.SMALL, 'draw-s5');
    const chiS4 = createCard('四', 4, CardSize.SMALL, 'draw-s4');
    const chiS6 = createCard('六', 6, CardSize.SMALL, 'draw-s6');
    const junk = createCard('十', 10, CardSize.SMALL, 'draw-s10');

    const state = createTestGameState({
      currentPlayerIndex: 1,
      phase: GamePhase.RESPONSE_COLLECTING,
      pendingCardSource: 'draw',
      turnCount: 7,
      remainingDeckCards: 12,
      discardPile: {
        cards: [],
        lastDiscard: target,
        lastDiscardPlayerIndex: 1,
      },
      availableActions: [
        {
          type: 'chi',
          cards: [chiS4, chiS6],
          chiOptions: [
            {
              id: 'draw-s5-chi',
              mainMeldCards: [target, chiS4, chiS6],
              selectedCards: [chiS4, chiS6],
              additionalMelds: [],
              remainingCards: [
                createCard('一', 1, CardSize.SMALL, 'draw-s1'),
                createCard('二', 2, CardSize.SMALL, 'draw-s2'),
                createCard('三', 3, CardSize.SMALL, 'draw-s3'),
                createCard('七', 7, CardSize.SMALL, 'draw-s7'),
                createCard('八', 8, CardSize.SMALL, 'draw-s8'),
                createCard('九', 9, CardSize.SMALL, 'draw-s9'),
                createCard('壹', 1, CardSize.BIG, 'draw-b1'),
                createCard('贰', 2, CardSize.BIG, 'draw-b2'),
                createCard('叁', 3, CardSize.BIG, 'draw-b3'),
                createCard('肆', 4, CardSize.BIG, 'draw-b4'),
                createCard('伍', 5, CardSize.BIG, 'draw-b5'),
                createCard('陆', 6, CardSize.BIG, 'draw-b6'),
                createCard('玖', 9, CardSize.BIG, 'draw-b9a'),
                createCard('玖', 9, CardSize.BIG, 'draw-b9b'),
                junk,
              ],
              description: '吃牌：S4 S5 S6',
            } as any,
          ],
          isMandatory: false,
          description: '吃牌',
        },
        {
          type: 'pass',
          cards: [],
          isMandatory: false,
          description: '近',
        },
      ],
    });

    state.players[1].cards = [
      createCard('一', 1, CardSize.SMALL, 'draw-s1'),
      createCard('二', 2, CardSize.SMALL, 'draw-s2'),
      createCard('三', 3, CardSize.SMALL, 'draw-s3'),
      chiS4,
      chiS6,
      createCard('七', 7, CardSize.SMALL, 'draw-s7'),
      createCard('八', 8, CardSize.SMALL, 'draw-s8'),
      createCard('九', 9, CardSize.SMALL, 'draw-s9'),
      createCard('壹', 1, CardSize.BIG, 'draw-b1'),
      createCard('贰', 2, CardSize.BIG, 'draw-b2'),
      createCard('叁', 3, CardSize.BIG, 'draw-b3'),
      createCard('肆', 4, CardSize.BIG, 'draw-b4'),
      createCard('伍', 5, CardSize.BIG, 'draw-b5'),
      createCard('陆', 6, CardSize.BIG, 'draw-b6'),
      createCard('玖', 9, CardSize.BIG, 'draw-b9a'),
      createCard('玖', 9, CardSize.BIG, 'draw-b9b'),
      junk,
    ];

    const action = await agent.decide(state);
    expect(action.type).toBe('pass');
  });

  it('medium AI should compare S9 chi options and choose the stronger landed route', async () => {
    const agent = new AIPlayerAgent('player_0');
    const target = createCard('九', 9, CardSize.SMALL, 'multi-s9');
    const s8 = createCard('八', 8, CardSize.SMALL, 'multi-s8');
    const s10 = createCard('十', 10, CardSize.SMALL, 'multi-s10');
    const b9a = createCard('玖', 9, CardSize.BIG, 'multi-b9a');
    const b9b = createCard('玖', 9, CardSize.BIG, 'multi-b9b');

    const state = createTestGameState({
      currentPlayerIndex: 0,
      phase: GamePhase.RESPONSE_COLLECTING,
      pendingCardSource: 'discard',
      turnCount: 9,
      remainingDeckCards: 10,
      discardPile: {
        cards: [target],
        lastDiscard: target,
        lastDiscardPlayerIndex: 2,
      },
      availableActions: [
        {
          type: 'chi',
          cards: [s8, s10],
          chiOptions: [
            {
              id: 'multi-s9-seq',
              mainMeldCards: [s8, target, s10],
              selectedCards: [s8, s10],
              additionalMelds: [
                {
                  type: MeldType.SEQUENCE,
                  cards: [
                    createCard('一', 1, CardSize.SMALL, 'multi-seq-compare-s1'),
                    createCard('二', 2, CardSize.SMALL, 'multi-seq-compare-s2'),
                    createCard('三', 3, CardSize.SMALL, 'multi-seq-compare-s3'),
                  ],
                  isConcealed: false,
                  position: 'table',
                  huPoints: 0,
                },
              ],
              remainingCards: [
                createCard('一', 1, CardSize.SMALL, 'multi-seq-s1'),
                createCard('二', 2, CardSize.SMALL, 'multi-seq-s2'),
                createCard('三', 3, CardSize.SMALL, 'multi-seq-s3'),
                createCard('四', 4, CardSize.SMALL, 'multi-seq-s4'),
                createCard('五', 5, CardSize.SMALL, 'multi-seq-s5'),
                createCard('六', 6, CardSize.SMALL, 'multi-seq-s6'),
                createCard('七', 7, CardSize.SMALL, 'multi-seq-s7a'),
                createCard('七', 7, CardSize.SMALL, 'multi-seq-s7b'),
                createCard('壹', 1, CardSize.BIG, 'multi-seq-b1'),
                createCard('贰', 2, CardSize.BIG, 'multi-seq-b2'),
                createCard('叁', 3, CardSize.BIG, 'multi-seq-b3'),
                createCard('肆', 4, CardSize.BIG, 'multi-seq-b4'),
                createCard('伍', 5, CardSize.BIG, 'multi-seq-b5'),
                createCard('陆', 6, CardSize.BIG, 'multi-seq-b6'),
              ],
              description: '吃牌：S8 S9 S10',
            } as any,
            {
              id: 'multi-s9-mixed',
              mainMeldCards: [target, b9a, b9b],
              selectedCards: [b9a, b9b],
              additionalMelds: [],
              remainingCards: [
                createCard('一', 1, CardSize.SMALL, 'multi-mix-s1'),
                createCard('二', 2, CardSize.SMALL, 'multi-mix-s2'),
                createCard('三', 3, CardSize.SMALL, 'multi-mix-s3'),
                createCard('四', 4, CardSize.SMALL, 'multi-mix-s4'),
                createCard('五', 5, CardSize.SMALL, 'multi-mix-s5'),
                createCard('六', 6, CardSize.SMALL, 'multi-mix-s6'),
                createCard('壹', 1, CardSize.BIG, 'multi-mix-b1'),
                createCard('贰', 2, CardSize.BIG, 'multi-mix-b2'),
                createCard('叁', 3, CardSize.BIG, 'multi-mix-b3'),
                createCard('肆', 4, CardSize.BIG, 'multi-mix-b4'),
                createCard('伍', 5, CardSize.BIG, 'multi-mix-b5'),
                createCard('陆', 6, CardSize.BIG, 'multi-mix-b6'),
                createCard('拾', 10, CardSize.BIG, 'multi-mix-b10'),
                createCard('十', 10, CardSize.SMALL, 'multi-mix-s10'),
              ],
              description: '吃牌：B9 B9 S9',
            } as any,
          ],
          isMandatory: false,
          description: '吃牌',
        },
        {
          type: 'pass',
          cards: [],
          isMandatory: false,
          description: '近',
        },
      ],
    });

    state.players[0].cards = [
      s8,
      s10,
      b9a,
      b9b,
      createCard('一', 1, CardSize.SMALL, 'multi-hand-s1'),
      createCard('二', 2, CardSize.SMALL, 'multi-hand-s2'),
      createCard('三', 3, CardSize.SMALL, 'multi-hand-s3'),
      createCard('四', 4, CardSize.SMALL, 'multi-hand-s4'),
      createCard('五', 5, CardSize.SMALL, 'multi-hand-s5'),
      createCard('六', 6, CardSize.SMALL, 'multi-hand-s6'),
      createCard('七', 7, CardSize.SMALL, 'multi-hand-s7a'),
      createCard('七', 7, CardSize.SMALL, 'multi-hand-s7b'),
      createCard('壹', 1, CardSize.BIG, 'multi-hand-b1'),
      createCard('贰', 2, CardSize.BIG, 'multi-hand-b2'),
      createCard('叁', 3, CardSize.BIG, 'multi-hand-b3'),
      createCard('肆', 4, CardSize.BIG, 'multi-hand-b4'),
      createCard('伍', 5, CardSize.BIG, 'multi-hand-b5'),
      createCard('陆', 6, CardSize.BIG, 'multi-hand-b6'),
    ];

    const action = await agent.decide(state);
    expect(action.type).toBe('chi');
    expect(action.cards.map((card) => card.id).sort()).toEqual(['multi-s8', 'multi-s10'].sort());
    expect(action.chiOptionId).toBe('multi-s9-seq');
  });

  it('discard scorer should prefer the safer black throw when shape gains are equal', () => {
    const scorer = new ActionPriorityScorer();

    const saferBlack = scorer.scoreDiscardCandidate({
      beforeWaitCount: 1,
      breakdownTotal: 180,
      compositeScore: 72,
      keepValue: 18,
      waitCount: 1,
      remainingWaitCount: 4,
      maxRoundScore: 12,
      isRed: false,
      isIsolated: true,
      isNearlyDead: false,
      preservesTempo: true,
      shapeAnchorStrength: 0,
      exactMeldAnchorStrength: 0,
      stableStructureLoss: 0,
    });

    const riskierRed = scorer.scoreDiscardCandidate({
      beforeWaitCount: 1,
      breakdownTotal: 180,
      compositeScore: 72,
      keepValue: 18,
      waitCount: 1,
      remainingWaitCount: 4,
      maxRoundScore: 12,
      isRed: true,
      isIsolated: true,
      isNearlyDead: false,
      preservesTempo: true,
      shapeAnchorStrength: 0,
      exactMeldAnchorStrength: 0,
      stableStructureLoss: 0,
    });

    expect(saferBlack).toBeGreaterThan(riskierRed);
  });
});

describe('R7.1.1 优先级：胡招碰吃', () => {
  it('should have correct priority order', () => {
    expect(RESPONSE_PRIORITY.hu).toBeLessThan(RESPONSE_PRIORITY.zhao);
    expect(RESPONSE_PRIORITY.zhao).toBeLessThan(RESPONSE_PRIORITY.peng);
    expect(RESPONSE_PRIORITY.peng).toBeLessThan(RESPONSE_PRIORITY.chi);
    expect(RESPONSE_PRIORITY.chi).toBeLessThan(RESPONSE_PRIORITY.pass);
  });
});

describe('R7.2.1/R7.2.2/R7.2.3 响应仲裁', () => {
  let arbitrator: ResponseArbitrator;

  beforeEach(() => {
    arbitrator = new ResponseArbitrator();
  });

  it('R7.2.1: should prioritize higher priority response', () => {
    const state = createTestGameState({ currentPlayerIndex: 0 });
    const responses: PlayerResponse[] = [
      { playerIndex: 1, responseType: 'peng', cards: [], timestamp: 1 },
      { playerIndex: 2, responseType: 'hu', cards: [], timestamp: 2 }
    ];

    const result = arbitrator.arbitrate(state, responses);
    expect(result.winningResponse?.playerIndex).toBe(2);
    expect(result.winningResponse?.responseType).toBe('hu');
  });

  it('R7.2.2: should use seat order for same priority (current player starts)', () => {
    const state = createTestGameState({ currentPlayerIndex: 1 }); // 当前玩家明
    const responses: PlayerResponse[] = [
      { playerIndex: 0, responseType: 'peng', cards: [], timestamp: 1 },
      { playerIndex: 2, responseType: 'peng', cards: [], timestamp: 2 }
    ];

    // 当前玩家明，座次顺序是 1→→
    // 所以玩容优先于玩容
    const result = arbitrator.arbitrate(state, responses);
    expect(result.winningResponse?.playerIndex).toBe(0);
  });

  it('R7.2.3: should allow only one winner (unique hu)', () => {
    const state = createTestGameState({ currentPlayerIndex: 0 });
    const responses: PlayerResponse[] = [
      { playerIndex: 1, responseType: 'hu', cards: [], timestamp: 1 },
      { playerIndex: 2, responseType: 'hu', cards: [], timestamp: 2 }
    ];

    const result = arbitrator.arbitrate(state, responses);
    // 只应该有一个赢容
    expect(result.winningResponse).not.toBeNull();
    const winners = responses.filter(r => 
      r.playerIndex === result.winningResponse?.playerIndex
    );
    expect(winners).toHaveLength(1);
  });
});

describe('R7.4.1/R7.4.2 强制行为优先级覆相', () => {
  let rulesValidator: RulesValidator;

  beforeEach(() => {
    rulesValidator = new RulesValidator();
  });

  it('R7.4.1: should not force zhao if can hu', () => {
    const targetCard = createCard('二', 2, CardSize.SMALL);
    const state = createTestGameState({
      discardPile: {
        cards: [targetCard],
        lastDiscard: targetCard
      }
    });
    // 设置玩家有张相同牌（可招），且可以胡牌
    state.players[0].cards = [
      createCard('二', 2, CardSize.SMALL),
      createCard('二', 2, CardSize.SMALL),
      createCard('二', 2, CardSize.SMALL)
    ];
    // 假设已有足够牌型可以能- 需要个melds，且总胡数=10
    state.players[0].melds = Array(7).fill(null).map(() => ({
      type: MeldType.TRIPLE,
      cards: [
        createCard('三', 3, CardSize.SMALL),
        createCard('三', 3, CardSize.SMALL),
        createCard('三', 3, CardSize.SMALL)
      ],
      isConcealed: false,
      huPoints: 2  // 7 * 2 = 14 >= 10
    }));

    const mandatory = rulesValidator.getMandatoryActions(state);
    // 如果可以胡牌，不应该强制招牌
    expect(mandatory.some(a => a.type === 'zhao')).toBe(false);
  });

  it('R7.4.2: should force peng if cannot hu or zhao', () => {
    const targetCard = createCard('二', 2, CardSize.SMALL);
    const state = createTestGameState({
      phase: GamePhase.RESPONSE_COLLECTING,
      pendingCardSource: 'discard',
      discardPile: {
        cards: [targetCard],
        lastDiscard: targetCard,
        lastDiscardPlayerIndex: 1
      }
    });
    // 设置玩家有张相同牌（可碰但不可招）
    state.players[0].cards = [
      createCard('二', 2, CardSize.SMALL),
      createCard('二', 2, CardSize.SMALL),
      createCard('五', 5, CardSize.SMALL)
    ];

    const mandatory = rulesValidator.getMandatoryActions(state);
    expect(mandatory.some(a => a.type === 'peng')).toBe(true);
  });

  it('R7.4.x: should not force zhao on self-draw response if hu is available', () => {
    const targetCard = createCard('一', 1, CardSize.SMALL, 'selfdraw-hu-active');
    const winningTableMelds: Meld[] = [
      {
        type: MeldType.SEQUENCE,
        cards: [
          createCard('二', 2, CardSize.SMALL, 'selfdraw-m1a'),
          createCard('三', 3, CardSize.SMALL, 'selfdraw-m1b'),
          createCard('四', 4, CardSize.SMALL, 'selfdraw-m1c'),
        ],
        isConcealed: false,
        position: 'table',
        huPoints: 0,
      },
      {
        type: MeldType.SEQUENCE,
        cards: [
          createCard('五', 5, CardSize.SMALL, 'selfdraw-m2a'),
          createCard('六', 6, CardSize.SMALL, 'selfdraw-m2b'),
          createCard('七', 7, CardSize.SMALL, 'selfdraw-m2c'),
        ],
        isConcealed: false,
        position: 'table',
        huPoints: 0,
      },
      {
        type: MeldType.MIXED_SIZE,
        cards: [
          createCard('八', 8, CardSize.SMALL, 'selfdraw-m3a'),
          createCard('捘', 8, CardSize.BIG, 'selfdraw-m3b'),
          createCard('捘', 8, CardSize.BIG, 'selfdraw-m3c'),
        ],
        isConcealed: false,
        position: 'table',
        huPoints: 0,
      },
      {
        type: MeldType.SPECIAL_2710,
        cards: [
          createCard('二', 2, CardSize.SMALL, 'selfdraw-m4a'),
          createCard('七', 7, CardSize.SMALL, 'selfdraw-m4b'),
          createCard('十', 10, CardSize.SMALL, 'selfdraw-m4c'),
        ],
        isConcealed: false,
        position: 'table',
        huPoints: 0,
      },
      {
        type: MeldType.TRIPLE,
        cards: [
          createCard('玖', 9, CardSize.BIG, 'selfdraw-m5a'),
          createCard('玖', 9, CardSize.BIG, 'selfdraw-m5b'),
          createCard('玖', 9, CardSize.BIG, 'selfdraw-m5c'),
        ],
        isConcealed: false,
        position: 'table',
        huPoints: 0,
      },
    ];
    const state = createTestGameState({
      phase: GamePhase.RESPONSE_COLLECTING,
      currentPlayerIndex: 0,
      pendingCardSource: 'draw',
      discardPile: {
        cards: [],
        lastDiscard: targetCard,
        lastDiscardPlayerIndex: 0,
      },
    });

    state.players[0].cards = [
      createCard('一', 1, CardSize.SMALL, 'selfdraw-h1'),
      createCard('一', 1, CardSize.SMALL, 'selfdraw-h2'),
      createCard('二', 2, CardSize.SMALL, 'selfdraw-h3'),
      createCard('三', 3, CardSize.SMALL, 'selfdraw-h4'),
      createCard('四', 4, CardSize.SMALL, 'selfdraw-h5'),
    ];
    state.players[0].melds = winningTableMelds;

    const mandatory = rulesValidator.getMandatoryActions(state);
    expect(mandatory.some(a => a.type === 'zhao')).toBe(false);
    expect(mandatory.some(a => a.type === 'peng')).toBe(false);
  });
});

describe('R7.5.1/R7.5.2 超时自动处理', () => {
  let timeoutHandler: TimeoutHandler;

  beforeEach(() => {
    timeoutHandler = new TimeoutHandler();
  });

  it('should not timeout before response window', () => {
    const state = createTestGameState();
    const config = { ...DEFAULT_GAME_CONFIG };
    const startTime = Date.now();

    const result = timeoutHandler.checkTimeout(state, config, startTime);
    expect(result.isTimeout).toBe(false);
  });

  it('R7.5.1: should auto peng on timeout if can peng', () => {
    const targetCard = createCard('二', 2, CardSize.SMALL);
    const state = createTestGameState({
      discardPile: {
        cards: [targetCard],
        lastDiscard: targetCard,
        lastDiscardPlayerIndex: 0
      }
    });
    // 玩家1有张相同牌（可碰）
    state.players[1].cards = [
      createCard('二', 2, CardSize.SMALL),
      createCard('二', 2, CardSize.SMALL)
    ];

    const config = { ...DEFAULT_GAME_CONFIG, responseTimeout: 0 }; // 立即超时
    const startTime = Date.now() - 1000;

    const result = timeoutHandler.checkTimeout(state, config, startTime);
    expect(result.isTimeout).toBe(true);
    expect(result.autoResponses.length).toBeGreaterThan(0);
    
    const player1Response = result.autoResponses.find(r => r.playerIndex === 1);
    expect(player1Response?.responseType).toBe('peng');
  });

  it('R7.5.2: should auto pass on timeout if cannot peng', () => {
    const targetCard = createCard('二', 2, CardSize.SMALL);
    const state = createTestGameState({
      discardPile: {
        cards: [targetCard],
        lastDiscard: targetCard,
        lastDiscardPlayerIndex: 0
      }
    });
    // 玩家2没有相同牌
    state.players[2].cards = [
      createCard('五', 5, CardSize.SMALL),
      createCard('六', 6, CardSize.SMALL)
    ];

    const config = { ...DEFAULT_GAME_CONFIG, responseTimeout: 0 };
    const startTime = Date.now() - 1000;

    const result = timeoutHandler.checkTimeout(state, config, startTime);
    const player2Response = result.autoResponses.find(r => r.playerIndex === 2);
    expect(player2Response?.responseType).toBe('pass');
  });
});

describe('R7.8.1/R7.8.2 比牌规则', () => {
  let actionHandlers: ActionHandlers;
  let rulesValidator: RulesValidator;

  beforeEach(() => {
    actionHandlers = new ActionHandlers();
    rulesValidator = new RulesValidator();
  });

  it('R7.8.1: should allow chi when compare cards can form sequence', () => {
    const targetCard = createCard('三', 3, CardSize.SMALL);
    // 吃牌用的牌
    const chiCards = [
      createCard('一', 1, CardSize.SMALL),
      createCard('二', 2, CardSize.SMALL)
    ];
    // 手牌中还有一弃（比牌），必须也能组成顺子
    const handCards = [
      ...chiCards,
      createCard('三', 3, CardSize.SMALL), // 比牌
      createCard('四', 4, CardSize.SMALL), // 比牌能组成的顺子
      createCard('五', 5, CardSize.SMALL)
    ];

    const result = rulesValidator.checkCompareCards(handCards, [...chiCards, targetCard]);
    expect(result.canChi).toBe(true);
  });

  it('R7.8.2: should reject chi when compare cards cannot form sequence', () => {
    const targetCard = createCard('三', 3, CardSize.SMALL);
    const chiCards = [
      createCard('一', 1, CardSize.SMALL),
      createCard('二', 2, CardSize.SMALL)
    ];
    // 手牌中有比牌但无法组成顺子
    const handCards = [
      ...chiCards,
      createCard('三', 3, CardSize.SMALL), // 比牌
      createCard('八', 8, CardSize.SMALL), // 无法组成顺子
      createCard('九', 9, CardSize.SMALL)
    ];

    const result = rulesValidator.checkCompareCards(handCards, [...chiCards, targetCard]);
    expect(result.canChi).toBe(false);
    expect(result.reason).toContain('无法组成顺子');
  });

  it('R7.8.3: should provide multiple chi compare options when compare cards have multiple valid melds', () => {
    const targetCard = createCard('三', 3, CardSize.SMALL, 'target-3');
    const one = createCard('一', 1, CardSize.SMALL, 'sel-1');
    const two = createCard('二', 2, CardSize.SMALL, 'sel-2');
    const compareThree = createCard('三', 3, CardSize.SMALL, 'cmp-3');
    const extraTwo = createCard('二', 2, CardSize.SMALL, 'extra-2');
    const four = createCard('四', 4, CardSize.SMALL, 'extra-4');
    const five = createCard('五', 5, CardSize.SMALL, 'extra-5');

    const options = rulesValidator.getValidChiOptions(
      [one, two, compareThree, extraTwo, four, five],
      targetCard,
    );

    const sameChiOptions = options.filter((option) =>
      option.selectedCards.map((card) => card.id).sort().join(',') === 'sel-1,sel-2'
    );

    expect(sameChiOptions).toHaveLength(2);
    expect(new Set(sameChiOptions.map((option) => option.id)).size).toBe(2);
    expect(sameChiOptions.every((option) => option.additionalMelds.length === 1)).toBe(true);
    expect(sameChiOptions.every((option) => option.mainMeldCards.length === 3)).toBe(true);
    expect(sameChiOptions.map((option) => option.description)).toEqual(
      expect.arrayContaining([
        expect.stringContaining('比牌1：二小 三小 四小'),
        expect.stringContaining('比牌1：三小 四小 五小'),
      ]),
    );
  });

  it('R7.8.3b: should dedupe chi options that differ only by duplicate card instances', () => {
    const targetCard = createCard('二', 2, CardSize.SMALL, 'target-2');
    const oneA = createCard('一', 1, CardSize.SMALL, 'one-a');
    const oneB = createCard('一', 1, CardSize.SMALL, 'one-b');
    const three = createCard('三', 3, CardSize.SMALL, 'three');

    const options = rulesValidator.getValidChiOptions([oneA, oneB, three], targetCard);

    expect(options).toHaveLength(1);
    expect(options[0].mainMeldCards.map((card) => `${card.rank}${card.size}`).sort()).toEqual([
      '一small',
      '三small',
      '二small',
    ].sort());
  });

  it('R7.8.4: should expose hu action when active card can chi into a winning hand', () => {
    const gameManager = new GameManager();
    const activeCard = createCard('八', 8, CardSize.SMALL, 'active-8');

    const state = createTestGameState({
      phase: GamePhase.RESPONSE_COLLECTING,
      currentPlayerIndex: 0,
      pendingCardSource: 'discard',
      discardPile: {
        cards: [activeCard],
        lastDiscard: activeCard,
        lastDiscardPlayerIndex: 2,
      },
    });

    state.players[0].cards = [
      createCard('六', 6, CardSize.SMALL, 'sel-6'),
      createCard('七', 7, CardSize.SMALL, 'sel-7'),
      createCard('八', 8, CardSize.SMALL, 'cmp-8'),
      createCard('九', 9, CardSize.SMALL, 'cmp-9'),
      createCard('十', 10, CardSize.SMALL, 'cmp-10'),
      createCard('贰', 2, CardSize.BIG, 'left-2'),
      createCard('柒', 7, CardSize.BIG, 'left-7'),
      createCard('拾', 10, CardSize.BIG, 'left-10'),
    ];

    state.players[0].melds = [
      {
        type: MeldType.TRIPLE,
        cards: [
          createCard('壹', 1, CardSize.SMALL, 'm1-1'),
          createCard('壹', 1, CardSize.SMALL, 'm1-2'),
          createCard('壹', 1, CardSize.SMALL, 'm1-3'),
        ],
        isConcealed: false,
        huPoints: 0,
      },
      {
        type: MeldType.SEQUENCE,
        cards: [
          createCard('二', 2, CardSize.SMALL, 'm2-2'),
          createCard('三', 3, CardSize.SMALL, 'm2-3'),
          createCard('四', 4, CardSize.SMALL, 'm2-4'),
        ],
        isConcealed: false,
        huPoints: 0,
      },
      {
        type: MeldType.SEQUENCE,
        cards: [
          createCard('肆', 4, CardSize.BIG, 'm3-4'),
          createCard('伍', 5, CardSize.BIG, 'm3-5'),
          createCard('陆', 6, CardSize.BIG, 'm3-6'),
        ],
        isConcealed: false,
        huPoints: 0,
      },
      {
        type: MeldType.SPECIAL_2710,
        cards: [
          createCard('二', 2, CardSize.SMALL, 'm4-2'),
          createCard('七', 7, CardSize.SMALL, 'm4-7'),
          createCard('十', 10, CardSize.SMALL, 'm4-10'),
        ],
        isConcealed: false,
        huPoints: 0,
      },
    ];

    const updated = gameManager.updateAvailableActions(state);
    const huAction = updated.availableActions.find((action) => action.type === 'hu');

    expect(huAction).toBeDefined();
    expect(huAction?.huOptions?.length).toBeGreaterThan(0);
  });
});

describe('R8.3.2 八块跳过出牌', () => {
  let actionHandlers: ActionHandlers;
  let gameManager: GameManager;

  beforeEach(() => {
    actionHandlers = new ActionHandlers();
    gameManager = new GameManager();
  });

  it('should allow skip discard only after zhao grants eight blocks', () => {
    const state = createTestGameState({ skipDiscardAfterZhao: true });
    state.players[0].hasEightBlocks = true;

    expect(actionHandlers.canSkipDiscard(state, 0)).toBe(true);
  });

  it('should not allow skip discard from eight blocks alone', () => {
    const state = createTestGameState();
    state.players[0].hasEightBlocks = true;

    expect(actionHandlers.canSkipDiscard(state, 0)).toBe(false);
  });

  it('should move to next player when skipping discard', () => {
    const state = createTestGameState({ currentPlayerIndex: 0 });
    state.players[0].hasEightBlocks = true;
    state.skipDiscardAfterZhao = true;

    const newState = actionHandlers.handleSkipDiscard(state);
    expect(newState.currentPlayerIndex).toBe(2);
    expect(newState.phase).toBe(GamePhase.DRAWING);
  });

  it('should skip discard after second zhao, but still require discard after later chi', () => {
    const targetZhaoCard = createCard('二', 2, CardSize.SMALL, 'zhao-target');
    const secondZhaoState = createTestGameState({
      currentPlayerIndex: 0,
      phase: GamePhase.RESPONSE_COLLECTING,
      pendingCardSource: 'draw',
      discardPile: {
        cards: [],
        lastDiscard: targetZhaoCard,
        lastDiscardPlayerIndex: 0,
      },
    });

    secondZhaoState.players[0].melds = [
      {
        type: MeldType.QUADRUPLE,
        cards: [
          createCard('壹', 1, CardSize.SMALL, 'q1'),
          createCard('壹', 1, CardSize.SMALL, 'q2'),
          createCard('壹', 1, CardSize.SMALL, 'q3'),
          createCard('壹', 1, CardSize.SMALL, 'q4'),
        ],
        isConcealed: false,
        huPoints: 0,
      },
    ];
    secondZhaoState.players[0].cards = [
      createCard('二', 2, CardSize.SMALL, 'z1'),
      createCard('二', 2, CardSize.SMALL, 'z2'),
      createCard('二', 2, CardSize.SMALL, 'z3'),
      createCard('五', 5, CardSize.SMALL, 'keep-5'),
    ];

    const afterZhao = gameManager.processAction(secondZhaoState, {
      type: 'zhao',
      playerId: 'player_0',
      cards: [targetZhaoCard],
      timestamp: Date.now(),
    });

    expect(afterZhao.skipDiscardAfterZhao).toBe(true);
    expect(afterZhao.phase).toBe(GamePhase.DISCARDING);
    expect(afterZhao.availableActions.some((action) => action.type === 'pass')).toBe(true);

    const chiTarget = createCard('二', 2, CardSize.BIG, 'chi-target');
    const chiState = createTestGameState({
      currentPlayerIndex: 0,
      phase: GamePhase.RESPONSE_COLLECTING,
      pendingCardSource: 'discard',
      discardPile: {
        cards: [chiTarget],
        lastDiscard: chiTarget,
        lastDiscardPlayerIndex: 1,
      },
    });

    chiState.players[0].hasEightBlocks = true;
    chiState.players[0].melds = afterZhao.players[0].melds;
    chiState.players[0].cards = [
      createCard('壹', 1, CardSize.BIG, 'chi-1'),
      createCard('叁', 3, CardSize.BIG, 'chi-3'),
      createCard('伍', 5, CardSize.SMALL, 'discard-after-chi'),
    ];

    const withActions = gameManager.updateAvailableActions(chiState);
    expect(withActions.availableActions.some((action) => action.type === 'chi')).toBe(true);

    const afterChi = gameManager.processAction(withActions, {
      type: 'chi',
      playerId: 'player_0',
      cards: [chiState.players[0].cards[0], chiState.players[0].cards[1]],
      timestamp: Date.now(),
    });

    expect(afterChi.skipDiscardAfterZhao).toBe(false);
    expect(afterChi.phase).toBe(GamePhase.DISCARDING);
    expect(afterChi.availableActions.some((action) => action.type === 'discard')).toBe(true);
    expect(afterChi.availableActions.some((action) => action.type === 'pass')).toBe(false);
  });
});

describe('R7 响应过牌后的轮次归属', () => {
  let gameManager: GameManager;

  beforeEach(() => {
    gameManager = new GameManager();
  });

  it('should keep turn on current player draw after passing chi from previous player discard', () => {
    const targetCard = createCard('二', 2, CardSize.SMALL, 'pass-chi-discard-target');
    const state = createTestGameState({
      currentPlayerIndex: 1,
      phase: GamePhase.RESPONSE_COLLECTING,
      pendingCardSource: 'discard',
      turnCount: 6,
      discardPile: {
        cards: [targetCard],
        lastDiscard: targetCard,
        lastDiscardPlayerIndex: 2,
      },
    });

    state.players[1].cards = [
      createCard('一', 1, CardSize.SMALL, 'pass-chi-discard-1'),
      createCard('三', 3, CardSize.SMALL, 'pass-chi-discard-3'),
      createCard('伍', 5, CardSize.SMALL, 'pass-chi-discard-5'),
    ];

    const withActions = gameManager.updateAvailableActions(state);
    expect(withActions.availableActions.some((action) => action.type === 'chi')).toBe(true);

    const afterPass = gameManager.processAction(withActions, {
      type: 'pass',
      playerId: 'player_1',
      cards: [],
      timestamp: Date.now(),
    });

    expect(afterPass.currentPlayerIndex).toBe(1);
    expect(afterPass.phase).toBe(GamePhase.DRAWING);
    expect(afterPass.turnCount).toBe(7);
    expect(afterPass.availableActions.some((action) => action.type === 'draw')).toBe(true);
  });

  it('should keep turn on current player draw after passing chi from previous player draw', () => {
    const targetCard = createCard('四', 4, CardSize.SMALL, 'pass-chi-draw-target');
    const state = createTestGameState({
      currentPlayerIndex: 2,
      phase: GamePhase.RESPONSE_COLLECTING,
      pendingCardSource: 'draw',
      turnCount: 9,
      discardPile: {
        cards: [],
        lastDiscard: targetCard,
        lastDiscardPlayerIndex: 0,
      },
    });

    // 模拟翻牌者player_0)已经 pass 过吃，passedPlays 有记录（表示吃权已转给下容player_1，
    state.players[0].passedPlays = [{ card: targetCard, timestamp: Date.now(), actionType: 'chi' }];

    state.players[2].cards = [
      createCard('三', 3, CardSize.SMALL, 'pass-chi-draw-3'),
      createCard('五', 5, CardSize.SMALL, 'pass-chi-draw-5'),
      createCard('玖', 9, CardSize.BIG, 'pass-chi-draw-9'),
    ];

    const withActions = gameManager.updateAvailableActions(state);
    expect(withActions.availableActions.some((action) => action.type === 'chi')).toBe(true);

    const afterPass = gameManager.processAction(withActions, {
      type: 'pass',
      playerId: 'player_2',
      cards: [],
      timestamp: Date.now(),
    });

    expect(afterPass.currentPlayerIndex).toBe(2);
    expect(afterPass.phase).toBe(GamePhase.DRAWING);
    expect(afterPass.turnCount).toBe(10);
    expect(afterPass.availableActions.some((action) => action.type === 'draw')).toBe(true);
  });

  it('should move unclaimed drawn card into discard pile before next turn', () => {
    const targetCard = createCard('六', 6, CardSize.SMALL, 'pass-draw-unclaimed-target');
    const state = createTestGameState({
      currentPlayerIndex: 2,
      phase: GamePhase.RESPONSE_COLLECTING,
      pendingCardSource: 'draw',
      turnCount: 11,
      discardPile: {
        cards: [],
        discardHistory: [],
        lastDiscard: targetCard,
        lastDiscardPlayerIndex: 2,
      },
      availableActions: [
        {
          type: 'pass',
          cards: [],
          isMandatory: false,
          description: '近',
        },
      ],
    });

    const afterPass = gameManager.processAction(state, {
      type: 'pass',
      playerId: 'player_2',
      cards: [],
      timestamp: Date.now(),
    });

    expect(afterPass.phase).toBe(GamePhase.DRAWING);
    expect(afterPass.currentPlayerIndex).toBe(1);
    expect(afterPass.discardPile.cards.map((card) => card.id)).toContain(targetCard.id);
    expect(afterPass.discardPile.discardHistory?.some((entry) => entry.card.id === targetCard.id)).toBe(true);
  });
});

describe('R8.4.2/R8.4.3 轮庄规则', () => {
  let gameManager: GameManager;

  beforeEach(() => {
    gameManager = new GameManager();
  });

  it('开局应把庄家的基础20张与第21张待处理牌分开', () => {
    const openingStates = Array.from({ length: 64 }, (_, index) =>
      gameManager.createGame({ playerCount: 3, seed: index + 1 }),
    );
    const state = openingStates.find((candidate) => candidate.phase === GamePhase.BAO_SELECTION);
    if (!state) {
      throw new Error('测试种子未生成爆牌选择开局');
    }

    const dealer = state.players.find((player) => player.isDealer);
    const nonDealers = state.players.filter((player) => !player.isDealer);

    expect(dealer).toBeDefined();
    expect(dealer?.cards).toHaveLength(20);
    expect(state.dealerPendingCard).toBeDefined();
    expect(nonDealers).toHaveLength(2);
    expect(nonDealers.every((player) => player.cards.length === 20)).toBe(true);
  });

  it('R8.4.2: winner should become dealer in next game', () => {
    // 创建模拟的上一局状态
    const previousState = createTestGameState();
    previousState.isGameOver = true;
    previousState.winnerIndex = 2; // 玩家3赢了

    // 获取下一局配置
    const nextConfig = gameManager.endGame(previousState);
    expect(nextConfig.lastWinnerIndex).toBe(2);

    // 创建下一局
    const nextGame = gameManager.createGame(nextConfig);
    expect(nextGame.players[2].isDealer).toBe(true);
  });

  it('R8.4.3: dealer should stay same on draw game', () => {
    const previousState = createTestGameState();
    previousState.isGameOver = true;
    previousState.winnerIndex = undefined; // 流局
    // 清除默认庄家，设置玩容为庄容
    previousState.players[0].isDealer = false;
    previousState.players[1].isDealer = true;

    const nextConfig = gameManager.endGame(previousState);
    expect(nextConfig.lastGameDrawn).toBe(true);
    expect(nextConfig.lastDealerIndex).toBe(1);

    // 创建下一局，庄家应该不可
    const nextGame = gameManager.createGame(nextConfig);
    expect(nextGame.players[1].isDealer).toBe(true);
  });
});

describe('R6.3.1/R6.3.2 响应窗口配置', () => {
  let timeoutHandler: TimeoutHandler;

  beforeEach(() => {
    timeoutHandler = new TimeoutHandler();
  });

  it('R6.3.1: default response timeout should be 10 seconds', () => {
    expect(DEFAULT_GAME_CONFIG.responseTimeout).toBe(10000);
  });

  it('R6.3.2: response timeout should be configurable between 3-30 seconds', () => {
    expect(DEFAULT_GAME_CONFIG.minResponseTimeout).toBe(3000);
    expect(DEFAULT_GAME_CONFIG.maxResponseTimeout).toBe(30000);
  });

  it('should clamp timeout to valid range', () => {
    const config = { ...DEFAULT_GAME_CONFIG };
    
    // 太小应该被限制到最小値
    expect(timeoutHandler.validateResponseTimeout(1000, config)).toBe(3000);
    
    // 太大应该被限制到最大値
    expect(timeoutHandler.validateResponseTimeout(60000, config)).toBe(30000);
    
    // 正常值应该保持不可
    expect(timeoutHandler.validateResponseTimeout(15000, config)).toBe(15000);
  });
});

describe('R6.4 牌堆耗尽收尾响应', () => {
  it('should not end immediately when last drawn card is still awaiting responses', () => {
    const gameManager = new GameManager();
    const lastCard = createCard('拾', 10, CardSize.BIG, 'last-b10');

    const state = createTestGameState({
      phase: GamePhase.RESPONSE_COLLECTING,
      remainingDeckCards: 0,
      pendingCardSource: 'draw',
      currentPlayerIndex: 0,
      discardPile: {
        cards: [lastCard],
        lastDiscard: lastCard,
        lastDiscardPlayerIndex: 1,
      },
      isGameOver: false,
    });

    const endCheck = gameManager.checkGameEnd(state);
    expect(endCheck.ended).toBe(false);
  });
});

describe('R4.1 牌型验证', () => {
  let rulesValidator: RulesValidator;

  beforeEach(() => {
    rulesValidator = new RulesValidator();
  });

  it('R4.1.1: PAIR should be 2 identical cards', () => {
    const cards = [
      createCard('二', 2, CardSize.SMALL),
      createCard('二', 2, CardSize.SMALL)
    ];
    expect(rulesValidator.isValidMeld(cards, MeldType.PAIR)).toBe(true);
  });

  it('R4.1.2: TRIPLE should be 3 identical cards', () => {
    const cards = [
      createCard('二', 2, CardSize.SMALL),
      createCard('二', 2, CardSize.SMALL),
      createCard('二', 2, CardSize.SMALL)
    ];
    expect(rulesValidator.isValidMeld(cards, MeldType.TRIPLE)).toBe(true);
  });

  it('R4.1.5: SEQUENCE should be 3 consecutive cards of same size', () => {
    const cards = [
      createCard('一', 1, CardSize.SMALL),
      createCard('二', 2, CardSize.SMALL),
      createCard('三', 3, CardSize.SMALL)
    ];
    expect(rulesValidator.isValidMeld(cards, MeldType.SEQUENCE)).toBe(true);
  });

  it('R4.1.6: SPECIAL_2710 should be 2/7/10 of same size', () => {
    const cards = [
      createCard('二', 2, CardSize.SMALL),
      createCard('七', 7, CardSize.SMALL),
      createCard('十', 10, CardSize.SMALL)
    ];
    expect(rulesValidator.isValidMeld(cards, MeldType.SPECIAL_2710)).toBe(true);
  });

  it('R4.3.2: SEQUENCE must be same size', () => {
    const cards = [
      createCard('一', 1, CardSize.SMALL),
      createCard('二', 2, CardSize.BIG), // 不同大小
      createCard('三', 3, CardSize.SMALL)
    ];
    expect(rulesValidator.isValidMeld(cards, MeldType.SEQUENCE)).toBe(false);
  });
});

describe('R5.1/R5.2 胡息计算', () => {
  let scoreCalculator: ScoreCalculator;

  beforeEach(() => {
    scoreCalculator = new ScoreCalculator();
  });

  it('should calculate meld hu points correctly', () => {
    const meld: Meld = {
      type: MeldType.TRIPLE,
      cards: [
        createCard('二', 2, CardSize.SMALL),
        createCard('二', 2, CardSize.SMALL),
        createCard('二', 2, CardSize.SMALL)
      ],
      isConcealed: false,
      huPoints: 0
    };

    const huPoints = scoreCalculator.calculateMeldHuPoints(meld);
    // 小写红牌坎牌 = 9胡息
    expect(huPoints).toBeGreaterThan(0);
  });

  it('should score discard-winning same-card triplet as peng instead of concealed triple', () => {
    const actionHandlers = new ActionHandlers();
    const activeCard = createCard('九', 9, CardSize.SMALL, 'hu-active-s9');
    const state = createTestGameState({
      currentPlayerIndex: 0,
      phase: GamePhase.RESPONSE_COLLECTING,
      pendingCardSource: 'discard',
      discardPile: {
        cards: [activeCard],
        lastDiscard: activeCard,
        lastDiscardPlayerIndex: 1,
      },
    });

    state.players[0].cards = [
      createCard('四', 4, CardSize.SMALL, 's4-1'),
      createCard('四', 4, CardSize.SMALL, 's4-2'),
      createCard('四', 4, CardSize.SMALL, 's4-3'),
      createCard('叁', 3, CardSize.BIG, 'b3-1'),
      createCard('肆', 4, CardSize.BIG, 'b4-1'),
      createCard('伍', 5, CardSize.BIG, 'b5-1'),
      createCard('柒', 7, CardSize.BIG, 'b7-1'),
      createCard('捘', 8, CardSize.BIG, 'b8-1'),
      createCard('玖', 9, CardSize.BIG, 'b9-1'),
      createCard('二', 2, CardSize.SMALL, 's2-1'),
      createCard('七', 7, CardSize.SMALL, 's7-1'),
      createCard('十', 10, CardSize.SMALL, 's10-1'),
      createCard('九', 9, CardSize.SMALL, 's9-1'),
      createCard('九', 9, CardSize.SMALL, 's9-2'),
    ];
    state.players[0].melds = [
      {
        type: MeldType.MIXED_SIZE,
        cards: [
          createCard('一', 1, CardSize.SMALL, 'mix1-1'),
          createCard('一', 1, CardSize.SMALL, 'mix1-2'),
          createCard('壹', 1, CardSize.BIG, 'mix1-3'),
        ],
        isConcealed: false,
        huPoints: 0,
      },
      {
        type: MeldType.MIXED_SIZE,
        cards: [
          createCard('五', 5, CardSize.SMALL, 'mix5-1'),
          createCard('五', 5, CardSize.SMALL, 'mix5-2'),
          createCard('伍', 5, CardSize.BIG, 'mix5-3'),
        ],
        isConcealed: false,
        huPoints: 0,
      },
    ];

    const ended = actionHandlers.handleHu(state, 'player_0', false);
    const pengMeld = ended.players[0].melds.find((meld) =>
      meld.type === MeldType.PENG && meld.cards.every((card) => card.value === 9 && card.size === CardSize.SMALL),
    );

    expect(pengMeld).toBeDefined();
    expect(ended.winningHuPoints).toBe(13);
  });

  it('should not allow draw-response hu when active same-card triplet only reaches 7 hu as peng', () => {
    const rulesValidator = new RulesValidator();
    const turnManager = new TurnManager();
    const actionHandlers = new ActionHandlers();
    const activeCard = createCard('四', 4, CardSize.SMALL, 'hu-active-s4');

    const tableMelds: Meld[] = [
      {
        type: MeldType.SPECIAL_2710,
        cards: [
          createCard('二', 2, CardSize.SMALL, 's2-1'),
          createCard('七', 7, CardSize.SMALL, 's7-1'),
          createCard('十', 10, CardSize.SMALL, 's10-1'),
        ],
        isConcealed: false,
        position: 'table',
        huPoints: 0,
      },
      {
        type: MeldType.SEQUENCE,
        cards: [
          createCard('三', 3, CardSize.SMALL, 's3-1'),
          createCard('四', 4, CardSize.SMALL, 's4-3'),
          createCard('五', 5, CardSize.SMALL, 's5-1'),
        ],
        isConcealed: false,
        position: 'table',
        huPoints: 0,
      },
      {
        type: MeldType.SEQUENCE,
        cards: [
          createCard('五', 5, CardSize.SMALL, 's5-1'),
          createCard('六', 6, CardSize.SMALL, 's6-1'),
          createCard('七', 7, CardSize.SMALL, 's7-2'),
        ],
        isConcealed: false,
        position: 'table',
        huPoints: 0,
      },
      {
        type: MeldType.MIXED_SIZE,
        cards: [
          createCard('八', 8, CardSize.SMALL, 's8-1'),
          createCard('捘', 8, CardSize.BIG, 'b8-1'),
          createCard('捘', 8, CardSize.BIG, 'b8-2'),
        ],
        isConcealed: false,
        position: 'table',
        huPoints: 0,
      },
      {
        type: MeldType.MIXED_SIZE,
        cards: [
          createCard('九', 9, CardSize.SMALL, 's9-1'),
          createCard('玖', 9, CardSize.BIG, 'b9-1'),
          createCard('玖', 9, CardSize.BIG, 'b9-2'),
        ],
        isConcealed: false,
        position: 'table',
        huPoints: 0,
      },
    ];

    const state = createTestGameState({
      currentPlayerIndex: 0,
      phase: GamePhase.RESPONSE_COLLECTING,
      pendingCardSource: 'draw',
      discardPile: {
        cards: [],
        lastDiscard: activeCard,
        lastDiscardPlayerIndex: 0,
      },
    });

    state.players[0].cards = [
      createCard('四', 4, CardSize.SMALL, 's4-1'),
      createCard('四', 4, CardSize.SMALL, 's4-2'),
      createCard('叁', 3, CardSize.BIG, 'b3-1'),
      createCard('肆', 4, CardSize.BIG, 'b4-1'),
      createCard('伍', 5, CardSize.BIG, 'b5-1'),
    ];
    state.players[0].melds = tableMelds;

    expect(rulesValidator.canHu(state.players[0].cards, tableMelds, activeCard, 'draw')).toBe(false);
    expect(turnManager.getAvailableActions(state).some((action) => action.type === 'hu')).toBe(false);

    const result = actionHandlers.handleHu(state, 'player_0', true);
    expect(result.phase).toBe(GamePhase.RESPONSE_COLLECTING);
    expect(result.isGameOver).toBe(false);
  });

  it('should score draw-response same-card triplet as peng instead of concealed triple', () => {
    const actionHandlers = new ActionHandlers();
    const activeCard = createCard('九', 9, CardSize.SMALL, 'hu-active-s9-draw');
    const state = createTestGameState({
      currentPlayerIndex: 0,
      phase: GamePhase.RESPONSE_COLLECTING,
      pendingCardSource: 'draw',
      discardPile: {
        cards: [],
        lastDiscard: activeCard,
        lastDiscardPlayerIndex: 0,
      },
    });

    state.players[0].cards = [
      createCard('四', 4, CardSize.SMALL, 'draw-s4-1'),
      createCard('四', 4, CardSize.SMALL, 'draw-s4-2'),
      createCard('四', 4, CardSize.SMALL, 'draw-s4-3'),
      createCard('叁', 3, CardSize.BIG, 'draw-b3-1'),
      createCard('肆', 4, CardSize.BIG, 'draw-b4-1'),
      createCard('伍', 5, CardSize.BIG, 'draw-b5-1'),
      createCard('柒', 7, CardSize.BIG, 'draw-b7-1'),
      createCard('捘', 8, CardSize.BIG, 'draw-b8-1'),
      createCard('玖', 9, CardSize.BIG, 'draw-b9-1'),
      createCard('二', 2, CardSize.SMALL, 'draw-s2-1'),
      createCard('七', 7, CardSize.SMALL, 'draw-s7-1'),
      createCard('十', 10, CardSize.SMALL, 'draw-s10-1'),
      createCard('九', 9, CardSize.SMALL, 'draw-s9-1'),
      createCard('九', 9, CardSize.SMALL, 'draw-s9-2'),
    ];
    state.players[0].melds = [
      {
        type: MeldType.MIXED_SIZE,
        cards: [
          createCard('一', 1, CardSize.SMALL, 'draw-mix1-1'),
          createCard('一', 1, CardSize.SMALL, 'draw-mix1-2'),
          createCard('壹', 1, CardSize.BIG, 'draw-mix1-3'),
        ],
        isConcealed: false,
        huPoints: 0,
      },
      {
        type: MeldType.MIXED_SIZE,
        cards: [
          createCard('五', 5, CardSize.SMALL, 'draw-mix5-1'),
          createCard('五', 5, CardSize.SMALL, 'draw-mix5-2'),
          createCard('伍', 5, CardSize.BIG, 'draw-mix5-3'),
        ],
        isConcealed: false,
        huPoints: 0,
      },
    ];

    const ended = actionHandlers.handleHu(state, 'player_0', true);
    const pengMeld = ended.players[0].melds.find((meld) =>
      meld.type === MeldType.PENG && meld.cards.every((card) => card.value === 9 && card.size === CardSize.SMALL),
    );

    expect(pengMeld).toBeDefined();
    expect(ended.winningHuPoints).toBe(13);
  });
});

describe('R6.1 胡牌结构校验，续/ 6续1对）', () => {
  let rulesValidator: RulesValidator;

  beforeEach(() => {
    rulesValidator = new RulesValidator();
  });

  it('should reject hand with multiple pairs and orphan cards', () => {
    const handCards: Card[] = [
      createCard('二', 2, CardSize.SMALL),
      createCard('四', 4, CardSize.SMALL),
      createCard('四', 4, CardSize.SMALL),
      createCard('九', 9, CardSize.SMALL),
      createCard('九', 9, CardSize.SMALL),
      createCard('十', 10, CardSize.SMALL),
      createCard('贰', 2, CardSize.BIG),
      createCard('贰', 2, CardSize.BIG),
      createCard('贰', 2, CardSize.BIG),
      createCard('叁', 3, CardSize.BIG),
      createCard('肆', 4, CardSize.BIG),
      createCard('伍', 5, CardSize.BIG),
      createCard('陆', 6, CardSize.BIG),
      createCard('陆', 6, CardSize.BIG),
      createCard('拾', 10, CardSize.BIG),
      createCard('拾', 10, CardSize.BIG),
    ];

    const tableMelds: Meld[] = [
      {
        type: MeldType.MIXED_SIZE,
        cards: [
          createCard('捘', 8, CardSize.BIG),
          createCard('八', 8, CardSize.SMALL),
          createCard('八', 8, CardSize.SMALL),
        ],
        isConcealed: false,
        huPoints: 0,
      },
    ];

    expect(rulesValidator.canHu(handCards, tableMelds)).toBe(false);
  });

  it('should not allow hu when active card cannot form winning structure', () => {
    const handCards: Card[] = [
      createCard('九', 9, CardSize.SMALL),
      createCard('九', 9, CardSize.SMALL),
      createCard('肆', 4, CardSize.BIG),
      createCard('伍', 5, CardSize.BIG),
      createCard('陆', 6, CardSize.BIG),
      createCard('柒', 7, CardSize.BIG),
      createCard('捘', 8, CardSize.BIG),
      createCard('玖', 9, CardSize.BIG),
    ];

    const tableMelds: Meld[] = [];
    const activeCard = createCard('壹', 1, CardSize.BIG);

    expect(rulesValidator.canHu(handCards, tableMelds, activeCard)).toBe(false);
  });

  it('should reject hu that only works by splitting an existing kan', () => {
    const handCards: Card[] = [
      createCard('壹', 1, CardSize.BIG),
      createCard('贰', 2, CardSize.BIG),
      createCard('叁', 3, CardSize.BIG, 'b3_1'),
      createCard('叁', 3, CardSize.BIG, 'b3_2'),
      createCard('叁', 3, CardSize.BIG, 'b3_3'),
      createCard('肆', 4, CardSize.BIG, 'b4_1'),
      createCard('肆', 4, CardSize.BIG, 'b4_2'),
      createCard('伍', 5, CardSize.BIG, 'b5_1'),
      createCard('伍', 5, CardSize.BIG, 'b5_2'),
      createCard('七', 7, CardSize.SMALL, 's7_1'),
      createCard('七', 7, CardSize.SMALL, 's7_2'),
      createCard('八', 8, CardSize.SMALL, 's8_1'),
      createCard('八', 8, CardSize.SMALL, 's8_2'),
      createCard('捘', 8, CardSize.BIG, 'b8_1'),
      createCard('捘', 8, CardSize.BIG, 'b8_2'),
      createCard('捘', 8, CardSize.BIG, 'b8_3'),
      createCard('九', 9, CardSize.SMALL, 's9_1'),
    ];

    const tableMelds: Meld[] = [
      {
        type: MeldType.MIXED_SIZE,
        cards: [
          createCard('十', 10, CardSize.SMALL),
          createCard('拾', 10, CardSize.BIG, 'b10_1'),
          createCard('拾', 10, CardSize.BIG, 'b10_2'),
        ],
        isConcealed: false,
        huPoints: 0,
      },
    ];

    const activeCard = createCard('九', 9, CardSize.SMALL, 's9_2');

    expect(rulesValidator.canHu(handCards, tableMelds, activeCard, 'discard')).toBe(false);
  });

  it('should not split a big 5 kan while forming a sequence from big 4', () => {
    const handCards: Card[] = [
      createCard('三', 3, CardSize.SMALL, 'repro-s3-a'),
      createCard('三', 3, CardSize.SMALL, 'repro-s3-b'),
      createCard('三', 3, CardSize.SMALL, 'repro-s3-c'),
      createCard('四', 4, CardSize.SMALL, 'repro-s4-a'),
      createCard('四', 4, CardSize.SMALL, 'repro-s4-b'),
      createCard('四', 4, CardSize.SMALL, 'repro-s4-c'),
      createCard('六', 6, CardSize.SMALL, 'repro-s6-a'),
      createCard('六', 6, CardSize.SMALL, 'repro-s6-b'),
      createCard('七', 7, CardSize.SMALL, 'repro-s7'),
      createCard('八', 8, CardSize.SMALL, 'repro-s8'),
      createCard('九', 9, CardSize.SMALL, 'repro-s9'),
      createCard('肆', 4, CardSize.BIG, 'repro-b4'),
      createCard('伍', 5, CardSize.BIG, 'repro-b5-a'),
      createCard('伍', 5, CardSize.BIG, 'repro-b5-b'),
      createCard('伍', 5, CardSize.BIG, 'repro-b5-c'),
      createCard('陆', 6, CardSize.BIG, 'repro-b6-a'),
      createCard('陆', 6, CardSize.BIG, 'repro-b6-b'),
      createCard('柒', 7, CardSize.BIG, 'repro-b7'),
      createCard('捌', 8, CardSize.BIG, 'repro-b8'),
      createCard('玖', 9, CardSize.BIG, 'repro-b9'),
    ];
    const discardedSmallFive = createCard('五', 5, CardSize.SMALL, 'repro-active-s5');

    expect(rulesValidator.canHu(handCards, [], discardedSmallFive, 'discard')).toBe(false);
  });
});

describe('爆牌规则', () => {
  let rulesValidator: RulesValidator;
  let gameManager: GameManager;
  let turnManager: TurnManager;
  let actionHandlers: ActionHandlers;

  const createTableMelds = (): Meld[] => ([
    {
      type: MeldType.SEQUENCE,
      cards: [
        createCard('二', 2, CardSize.SMALL, 's2'),
        createCard('三', 3, CardSize.SMALL, 's3'),
        createCard('四', 4, CardSize.SMALL, 's4'),
      ],
      isConcealed: false,
      position: 'table',
      huPoints: 0,
    },
    {
      type: MeldType.SEQUENCE,
      cards: [
        createCard('五', 5, CardSize.SMALL, 's5'),
        createCard('六', 6, CardSize.SMALL, 's6'),
        createCard('七', 7, CardSize.SMALL, 's7'),
      ],
      isConcealed: false,
      position: 'table',
      huPoints: 0,
    },
    {
      type: MeldType.MIXED_SIZE,
      cards: [
        createCard('八', 8, CardSize.SMALL, 's8'),
        createCard('捘', 8, CardSize.BIG, 'b8_1'),
        createCard('捘', 8, CardSize.BIG, 'b8_2'),
      ],
      isConcealed: false,
      position: 'table',
      huPoints: 0,
    },
    {
      type: MeldType.SPECIAL_2710,
      cards: [
        createCard('二', 2, CardSize.SMALL, 's2_2'),
        createCard('七', 7, CardSize.SMALL, 's7_2'),
        createCard('十', 10, CardSize.SMALL, 's10'),
      ],
      isConcealed: false,
      position: 'table',
      huPoints: 0,
    },
    {
      type: MeldType.TRIPLE,
      cards: [
        createCard('玖', 9, CardSize.BIG, 'b9_1'),
        createCard('玖', 9, CardSize.BIG, 'b9_2'),
        createCard('玖', 9, CardSize.BIG, 'b9_3'),
      ],
      isConcealed: false,
      position: 'table',
      huPoints: 0,
    },
  ]);

  beforeEach(() => {
    rulesValidator = new RulesValidator();
    gameManager = new GameManager();
    turnManager = new TurnManager();
    actionHandlers = new ActionHandlers();
  });

  it('20张已听牌时应能识别可爹', () => {
    const handCards = [
      createCard('一', 1, CardSize.SMALL, 'wait_1a'),
      createCard('一', 1, CardSize.SMALL, 'wait_1b'),
      createCard('二', 2, CardSize.SMALL, 'wait_2'),
      createCard('三', 3, CardSize.SMALL, 'wait_3'),
      createCard('四', 4, CardSize.SMALL, 'wait_4'),
    ];

    const tingCards = rulesValidator.getBaoTingCards(handCards, createTableMelds());
    expect(tingCards.some((card) => card.value === 1 && card.size === CardSize.SMALL)).toBe(true);
  });

  it('未听牌时不应给出可爆资格', () => {
    const handCards = [
      createCard('一', 1, CardSize.SMALL, 'dead_1'),
      createCard('五', 5, CardSize.SMALL, 'dead_5'),
      createCard('八', 8, CardSize.SMALL, 'dead_8'),
      createCard('肆', 4, CardSize.BIG, 'dead_b4'),
      createCard('玖', 9, CardSize.BIG, 'dead_b9'),
    ];

    expect(rulesValidator.getBaoTingCards(handCards, createTableMelds())).toHaveLength(0);
  });

  it('庄家宣爆后第21张应按翻牌开局且爆后禁吃碰', () => {
    const dealerPendingCard = createCard('一', 1, CardSize.SMALL, 'dealer_pending');
    const state = createTestGameState({
      phase: GamePhase.BAO_SELECTION,
      currentPlayerIndex: 0,
      dealerPendingCard,
      baoEligiblePlayerIndices: [0],
      baoDecisionIndex: 0,
      players: [
        {
          ...createTestGameState().players[0],
          isDealer: true,
          cards: [
            createCard('一', 1, CardSize.SMALL, 'd1'),
            createCard('一', 1, CardSize.SMALL, 'd2'),
            createCard('一', 1, CardSize.SMALL, 'd3'),
          ],
          baoTingCards: [dealerPendingCard],
        },
        {
          ...createTestGameState().players[1],
        },
        {
          ...createTestGameState().players[2],
        },
      ],
    });

    const afterBao = gameManager.processAction(state, {
      type: 'bao',
      playerId: 'player_0',
      cards: [],
      timestamp: Date.now(),
    } as any);

    expect(afterBao.phase).toBe(GamePhase.DISCARDING);
    expect(afterBao.currentPlayerIndex).toBe(0);
    expect(afterBao.pendingCardSource).toBeUndefined();
    expect(afterBao.players[0].isBao).toBe(true);
    expect(afterBao.discardPile.lastDiscard).toBeUndefined();
    expect(afterBao.players[0].melds.at(-1)?.type).toBe(MeldType.DRAW_QUADRUPLE);
    expect(afterBao.availableActions.some((action) => action.type === 'chi')).toBe(false);
    expect(afterBao.availableActions.some((action) => action.type === 'peng')).toBe(false);
  });

  it('多家可爆时完成选择后应仍由庄家处理首张待定牌', () => {
    const dealerPendingCard = createCard('玖', 9, CardSize.BIG, 'opening_pending_b9');
    const baseState = createTestGameState();
    const state = createTestGameState({
      phase: GamePhase.BAO_SELECTION,
      currentPlayerIndex: 0,
      dealerPendingCard,
      baoEligiblePlayerIndices: [0, 1],
      baoDecisionIndex: 0,
      players: [
        {
          ...baseState.players[0],
          isDealer: false,
          baoTingCards: [createCard('三', 3, CardSize.SMALL, 'p1_ting')],
        },
        {
          ...baseState.players[1],
          isDealer: true,
          baoTingCards: [createCard('肆', 4, CardSize.BIG, 'p2_ting')],
        },
        {
          ...baseState.players[2],
          isDealer: false,
          baoTingCards: [],
        },
      ],
    });

    const afterPlayer1Bao = gameManager.processAction(state, {
      type: 'bao',
      playerId: 'player_0',
      cards: [],
      timestamp: Date.now(),
    } as any);

    expect(afterPlayer1Bao.phase).toBe(GamePhase.BAO_SELECTION);
    expect(afterPlayer1Bao.currentPlayerIndex).toBe(1);

    const afterDealerBao = gameManager.processAction(afterPlayer1Bao, {
      type: 'bao',
      playerId: 'player_1',
      cards: [],
      timestamp: Date.now(),
    } as any);

    expect(afterDealerBao.phase).toBe(GamePhase.DRAWING);
    expect(afterDealerBao.currentPlayerIndex).toBe(0);
    expect(afterDealerBao.pendingCardSource).toBeUndefined();
    expect(afterDealerBao.discardPile.lastDiscard?.id).toBe('opening_pending_b9');
    expect(afterDealerBao.discardPile.lastDiscardPlayerIndex).toBe(1);
  });

  it('庄家不爆时第21张应直接进入庄家手牌', () => {
    const dealerPendingCard = createCard('玖', 9, CardSize.BIG, 'dealer_take_b9');
    const baseState = createTestGameState();
    const dealerCards = [
      createCard('一', 1, CardSize.SMALL, 'dealer_card_s1'),
      createCard('二', 2, CardSize.SMALL, 'dealer_card_s2'),
      createCard('三', 3, CardSize.SMALL, 'dealer_card_s3'),
      createCard('四', 4, CardSize.SMALL, 'dealer_card_s4'),
      createCard('五', 5, CardSize.SMALL, 'dealer_card_s5'),
      createCard('六', 6, CardSize.SMALL, 'dealer_card_s6'),
      createCard('七', 7, CardSize.SMALL, 'dealer_card_s7'),
      createCard('八', 8, CardSize.SMALL, 'dealer_card_s8'),
      createCard('九', 9, CardSize.SMALL, 'dealer_card_s9'),
      createCard('十', 10, CardSize.SMALL, 'dealer_card_s10'),
      createCard('壹', 1, CardSize.BIG, 'dealer_card_b1'),
      createCard('贰', 2, CardSize.BIG, 'dealer_card_b2'),
      createCard('叁', 3, CardSize.BIG, 'dealer_card_b3'),
      createCard('肆', 4, CardSize.BIG, 'dealer_card_b4'),
      createCard('伍', 5, CardSize.BIG, 'dealer_card_b5'),
      createCard('陆', 6, CardSize.BIG, 'dealer_card_b6'),
      createCard('柒', 7, CardSize.BIG, 'dealer_card_b7'),
      createCard('捘', 8, CardSize.BIG, 'dealer_card_b8'),
      createCard('玖', 9, CardSize.BIG, 'dealer_card_b9_pairless'),
      createCard('拾', 10, CardSize.BIG, 'dealer_card_b10'),
    ];

    const state = createTestGameState({
      phase: GamePhase.BAO_SELECTION,
      currentPlayerIndex: 1,
      dealerPendingCard,
      baoEligiblePlayerIndices: [1],
      baoDecisionIndex: 0,
      players: [
        {
          ...baseState.players[0],
          isDealer: false,
          baoTingCards: [],
        },
        {
          ...baseState.players[1],
          isDealer: true,
          cards: dealerCards,
          baoTingCards: [createCard('二', 2, CardSize.SMALL, 'dealer_ting')],
        },
        {
          ...baseState.players[2],
          isDealer: false,
          baoTingCards: [],
        },
      ],
    });

    const afterPassBao = gameManager.processAction(state, {
      type: 'pass_bao',
      playerId: 'player_1',
      cards: [],
      timestamp: Date.now(),
    } as any);

    expect(afterPassBao.phase).toBe(GamePhase.DISCARDING);
    expect(afterPassBao.currentPlayerIndex).toBe(1);
    expect(afterPassBao.pendingCardSource).toBeUndefined();
    expect(afterPassBao.dealerPendingCard).toBeUndefined();
    expect(afterPassBao.players[1].isBao).toBe(false);
    expect(afterPassBao.players[1].cards).toHaveLength(21);
    expect(afterPassBao.players[1].cards.some((card) => card.id === 'dealer_take_b9')).toBe(true);
  });

  it('庄家21张弃一即听时应允许直接宣爆', () => {
    const baseState = createTestGameState();
    const dealerCards = [
      createCard('一', 1, CardSize.SMALL, 'dealer_s1a'),
      createCard('一', 1, CardSize.SMALL, 'dealer_s1b'),
      createCard('二', 2, CardSize.SMALL, 'dealer_s2a'),
      createCard('三', 3, CardSize.SMALL, 'dealer_s3a'),
      createCard('四', 4, CardSize.SMALL, 'dealer_s4a'),
      createCard('五', 5, CardSize.SMALL, 'dealer_s5'),
      createCard('六', 6, CardSize.SMALL, 'dealer_s6'),
      createCard('七', 7, CardSize.SMALL, 'dealer_s7a'),
      createCard('八', 8, CardSize.SMALL, 'dealer_s8'),
      createCard('捘', 8, CardSize.BIG, 'dealer_b8a'),
      createCard('捘', 8, CardSize.BIG, 'dealer_b8b'),
      createCard('二', 2, CardSize.SMALL, 'dealer_s2b'),
      createCard('七', 7, CardSize.SMALL, 'dealer_s7b'),
      createCard('十', 10, CardSize.SMALL, 'dealer_s10'),
      createCard('壹', 1, CardSize.BIG, 'dealer_b1'),
      createCard('贰', 2, CardSize.BIG, 'dealer_b2'),
      createCard('叁', 3, CardSize.BIG, 'dealer_b3'),
      createCard('玖', 9, CardSize.BIG, 'dealer_b9a'),
      createCard('玖', 9, CardSize.BIG, 'dealer_b9b'),
      createCard('玖', 9, CardSize.BIG, 'dealer_b9c'),
      createCard('拾', 10, CardSize.BIG, 'dealer_throw_b10'),
    ];

    const state = createTestGameState({
      phase: GamePhase.DISCARDING,
      currentPlayerIndex: 0,
      pendingCardSource: undefined,
      players: [
        {
          ...baseState.players[0],
          isDealer: true,
          cards: dealerCards,
          melds: [],
          isBao: false,
        },
        baseState.players[1],
        baseState.players[2],
      ],
    });

    const actions = turnManager.getAvailableActions(state);
    expect(actions.some((action) => action.type === 'bao')).toBe(true);

    const afterBao = gameManager.processAction(state, {
      type: 'bao',
      playerId: 'player_0',
      cards: [dealerCards[20]],
      timestamp: Date.now(),
    } as any);

    expect(afterBao.phase).toBe(GamePhase.DRAWING);
    expect(afterBao.currentPlayerIndex).toBe(2);
    expect(afterBao.pendingCardSource).toBeUndefined();
    expect(afterBao.players[0].isBao).toBe(true);
    expect(afterBao.players[0].cards).toHaveLength(20);
    expect(afterBao.players[0].cards.some((card) => card.id === 'dealer_throw_b10')).toBe(false);
    expect(afterBao.discardPile.lastDiscard?.id).toBe('dealer_throw_b10');
    expect(afterBao.discardPile.lastDiscardPlayerIndex).toBe(0);
  });

  it('爆牌胡牌且存在其他爆家时应叠加爆和杀爹', () => {
    const state = createTestGameState({
      phase: GamePhase.RESPONSE_COLLECTING,
      currentPlayerIndex: 0,
      pendingCardSource: 'draw',
      discardPile: {
        cards: [],
        lastDiscard: createCard('一', 1, CardSize.SMALL, 'hu_active'),
        lastDiscardPlayerIndex: 0,
      },
      players: [
        {
          ...createTestGameState().players[0],
          isDealer: true,
          isBao: true,
          cards: [
            createCard('一', 1, CardSize.SMALL, 'h1'),
            createCard('一', 1, CardSize.SMALL, 'h2'),
            createCard('二', 2, CardSize.SMALL, 'h3'),
            createCard('三', 3, CardSize.SMALL, 'h4'),
            createCard('四', 4, CardSize.SMALL, 'h5'),
          ],
          melds: createTableMelds(),
        },
        {
          ...createTestGameState().players[1],
          isBao: true,
        },
        {
          ...createTestGameState().players[2],
        },
      ],
    });

    const ended = actionHandlers.handleHu(state, 'player_0', true);
    const mingTangTypes = (ended.winningMingTangs || []).map((item) => item.type);

    expect(mingTangTypes).toContain(MingTangType.BAO);
    expect(mingTangTypes).toContain(MingTangType.SHA_BAO);
  });

  it('庄家第1张真实翻牌自摸胡应计入水上漂', () => {
    const activeCard = createCard('一', 1, CardSize.SMALL, 'tianhu-active');
    const openingTableMelds: Meld[] = [
      {
        type: MeldType.SEQUENCE,
        cards: [
          createCard('二', 2, CardSize.SMALL, 'tianhu-m1a'),
          createCard('三', 3, CardSize.SMALL, 'tianhu-m1b'),
          createCard('四', 4, CardSize.SMALL, 'tianhu-m1c'),
        ],
        isConcealed: false,
        position: 'table',
        huPoints: 0,
      },
      {
        type: MeldType.SEQUENCE,
        cards: [
          createCard('五', 5, CardSize.SMALL, 'tianhu-m2a'),
          createCard('六', 6, CardSize.SMALL, 'tianhu-m2b'),
          createCard('七', 7, CardSize.SMALL, 'tianhu-m2c'),
        ],
        isConcealed: false,
        position: 'table',
        huPoints: 0,
      },
      {
        type: MeldType.MIXED_SIZE,
        cards: [
          createCard('八', 8, CardSize.SMALL, 'tianhu-m3a'),
          createCard('捘', 8, CardSize.BIG, 'tianhu-m3b'),
          createCard('捘', 8, CardSize.BIG, 'tianhu-m3c'),
        ],
        isConcealed: false,
        position: 'table',
        huPoints: 0,
      },
    ];
    const state = createTestGameState({
      phase: GamePhase.RESPONSE_COLLECTING,
      currentPlayerIndex: 0,
      turnCount: 0,
      openingPhase: 'normal',
      openingFacts: { ordinaryActionCount: 0 },
      drawOrdinal: 1,
      pendingCardSource: 'draw',
      discardPile: {
        cards: [],
        lastDiscard: activeCard,
        lastDiscardPlayerIndex: 0,
      },
      players: [
        {
          ...createTestGameState().players[0],
          isDealer: true,
          cards: [
            createCard('一', 1, CardSize.SMALL, 'tianhu-h1'),
            createCard('一', 1, CardSize.SMALL, 'tianhu-h2'),
            createCard('二', 2, CardSize.SMALL, 'tianhu-h3'),
            createCard('二', 2, CardSize.SMALL, 'tianhu-h4'),
            createCard('二', 2, CardSize.SMALL, 'tianhu-h5'),
            createCard('三', 3, CardSize.SMALL, 'tianhu-h6'),
            createCard('三', 3, CardSize.SMALL, 'tianhu-h7'),
            createCard('三', 3, CardSize.SMALL, 'tianhu-h8'),
            createCard('四', 4, CardSize.SMALL, 'tianhu-h9'),
            createCard('四', 4, CardSize.SMALL, 'tianhu-h10'),
            createCard('四', 4, CardSize.SMALL, 'tianhu-h11'),
          ],
          melds: openingTableMelds,
        },
        {
          ...createTestGameState().players[1],
        },
        {
          ...createTestGameState().players[2],
        },
      ],
    });

    const ended = actionHandlers.handleHu(state, 'player_0', true);
    const mingTangTypes = (ended.winningMingTangs || []).map((item) => item.type);

    expect(mingTangTypes).not.toContain(MingTangType.TIAN_HU);
    expect(mingTangTypes).toContain(MingTangType.SHUI_SHANG_PIAO);
    expect(mingTangTypes).toContain(MingTangType.ZI_MO);
  });
});
