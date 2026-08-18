/**
 * 游戏状态和规则类型定义
 * 泸州大贰游戏规则
 */

import { Card } from './card';

// 导出 Card 类型供其他模块使用
export type { Card } from './card';

/**
 * 牌型组合类型
 */
export enum MeldType {
  /** 对子 - 2张相同 */
  PAIR = 'pair',
  /** 碰牌 - 桌面3张相同 */
  PENG = 'peng',
  /** 坎牌 - 起手3张相同，固定不可拆 */
  TRIPLE = 'triple',
  /** 垅牌 - 起手4张相同，必须晒出 */
  QUADRUPLE = 'quadruple',
  /** 招牌 - 已有3张，摸到第4张 */
  DRAW_QUADRUPLE = 'draw_quadruple',
  /** 列牌 - 3张顺子 */
  SEQUENCE = 'sequence',
  /** 特殊组合 - 2/7/10 */
  SPECIAL_2710 = 'special_2710',
  /** 大小混搭 - 2张相同大小写 + 1张同数字不同大小写 */
  MIXED_SIZE = 'mixed_size'
}

/**
 * 胡牌方式
 */
export enum WinType {
  /** 自摸 - 自己摸到胡牌 */
  SELF_DRAW = 'self_draw',
  /** 点炮 - 别人打出的牌胡牌 */
  DISCARD = 'discard'
}

/**
 * 名堂/番型
 */
export enum MingTangType {
  /** 恰 */
  QIA = 'qia',
  /** 乱 */
  LUAN = 'luan',
  /** 红 */
  HONG = 'hong',
  /** 黑 */
  HEI = 'hei',
  /** 天胡 */
  TIAN_HU = 'tian_hu',
  /** 水上漂 */
  SHUI_SHANG_PIAO = 'shui_shang_piao',
  /** 海底捞 */
  HAI_DI_LAO = 'hai_di_lao',
  /** 昆 */
  KUN = 'kun',
  /** 归 */
  GUI = 'gui',
  /** 自摸 */
  ZI_MO = 'zi_mo',
  /** 爆 */
  BAO = 'bao',
  /** 杀爆 */
  SHA_BAO = 'sha_bao'
}

export type EnabledMingTangMap = Record<MingTangType, boolean>;

export const DEFAULT_ENABLED_MINGTANG_TYPES: EnabledMingTangMap = {
  [MingTangType.QIA]: true,
  [MingTangType.LUAN]: true,
  [MingTangType.HONG]: true,
  [MingTangType.HEI]: true,
  [MingTangType.TIAN_HU]: true,
  [MingTangType.SHUI_SHANG_PIAO]: true,
  [MingTangType.HAI_DI_LAO]: true,
  [MingTangType.KUN]: true,
  [MingTangType.GUI]: true,
  [MingTangType.ZI_MO]: true,
  [MingTangType.BAO]: true,
  [MingTangType.SHA_BAO]: true,
};

export interface BaoDecisionRecord {
  playerIndex: number;
  declared: boolean;
  tingCards: Card[];
}

export interface MingTang {
  type: MingTangType;
  name: string;
  fan: number;
  description: string;
}

/**
 * 牌型组合
 */
export interface Meld {
  type: MeldType;
  cards: Card[];
  /** 是否暗牌（在手中） */
  isConcealed: boolean;
  /** 位置 */
  position?: 'hand' | 'table';
  /** 计算的胡息 */
  huPoints: number;
}

export interface CompareCardResult {
  canChi: boolean;
  remainingCards: Card[];
  additionalMelds: Meld[];
  reason?: string;
}

export interface ChiOption {
  /** 方案唯一标识 */
  id: string;
  /** 本次吃牌形成的主牌组（包含目标牌） */
  mainMeldCards: Card[];
  /** 当前这手吃牌从手牌中选中的2张 */
  selectedCards: Card[];
  /** 比牌额外形成的牌组 */
  additionalMelds: Meld[];
  /** 执行该方案后的剩余手牌 */
  remainingCards: Card[];
  /** 便于前端展示的说明文本 */
  description: string;
}

/**
 * 游戏阶段
 */
export enum GamePhase {
  /** 开局爆牌选择阶段 */
  BAO_SELECTION = 'bao_selection',
  /** 摸牌阶段 */
  DRAWING = 'drawing',
  /** 出牌阶段 */
  DISCARDING = 'discarding',
  /** 吃碰杠阶段 */
  MELDING = 'melding',
  /** 等待响应阶段 */
  WAITING = 'waiting',
  /** 响应收集阶段 */
  RESPONSE_COLLECTING = 'response_collecting',
  /** 游戏结束 */
  ENDED = 'ended'
}

/**
 * 响应类型
 */
export type ResponseType = 'hu' | 'zhao' | 'peng' | 'chi' | 'pass';

/** 响应窗口到期后只能由核心接受的规范系统动作。 */
export type ResponseTimeoutAction = 'timeout_pass' | 'timeout_peng' | 'timeout_zhao';

/**
 * 响应优先级（数字越小优先级越高）
 */
export const RESPONSE_PRIORITY: Record<ResponseType, number> = {
  hu: 1,
  zhao: 2,
  peng: 3,
  chi: 4,
  pass: 99
};

/**
 * 玩家响应
 */
export interface PlayerResponse {
  /** 玩家索引 */
  playerIndex: number;
  /** 响应类型 */
  responseType: ResponseType;
  /** 响应涉及的牌 */
  cards: Card[];
  /** 响应时间戳 */
  timestamp: number;
  /** 选中的吃/比牌方案，保留到响应仲裁完成 */
  chiOptionId?: string;
  /** 选中的胡牌落地方案，保留到响应仲裁完成 */
  huOptionId?: string;
}

export type OpeningPhase = 'bao_selection' | 'dealer_pending_resolution' | 'normal';

export interface OpeningFacts {
  /** 开局实际完成的普通动作数；爆牌选择和系统推进不计入。 */
  ordinaryActionCount: number;
}

/** 响应窗口与正常轮次归属分离，避免出牌者被误当作响应者。 */
export interface ResponseWindow {
  id: string;
  source: 'discard' | 'draw';
  sourcePlayerIndex: number;
  activeCard: Card;
  responderOrder: number[];
  currentResponderIndex?: number;
  responses: PlayerResponse[];
  openedAt: number;
  /** 窗口的绝对截止时间，使用同一时钟计算。 */
  deadlineAt: number;
  /** 到期时应提交的规范系统动作。 */
  timeoutAction: ResponseTimeoutAction;
}

/**
 * 玩家手牌
 */
export interface PlayerHand {
  /** 玩家ID */
  playerId: string;
  /** 玩家名称 */
  playerName: string;
  /** 手牌（未组合的牌） */
  cards: Card[];
  /** 已组合的牌型 */
  melds: Meld[];
  /** 是否为当前玩家 */
  isCurrentPlayer: boolean;
  /** 是否为庄家 */
  isDealer: boolean;
  /** 是否激活八块特权 */
  hasEightBlocks: boolean;
  /** 总得分 */
  totalScore: number;
  /** 放弃过的机会（过张记录） */
  passedPlays: PassedPlay[];
  /** 已吃过的牌（用于比牌检查） */
  chiHistory: Card[];
  /** 是否已宣爆 */
  isBao?: boolean;
  /** 开局20张时的听牌结果 */
  baoTingCards?: Card[];
}

/**
 * 弃牌堆
 */
export interface DiscardPile {
  /** 已打出的牌 */
  cards: Card[];
  /** 公开废牌事件历史；翻牌和出牌使用同一事件契约。 */
  discardHistory?: DiscardEvent[];
  /** 最后一张打出的牌 */
  lastDiscard?: Card;
  /** 最后出牌的玩家索引 */
  lastDiscardPlayerIndex?: number;
}

/**
 * 游戏状态
 */
export interface GameState {
  /** 玩家列表 */
  players: PlayerHand[];
  /** 当前玩家索引（当前轮玩家） */
  currentPlayerIndex: number;
  /** 弃牌堆 */
  discardPile: DiscardPile;
  /** 桌面上的牌型 */
  tableMelds: Meld[];
  /** 当前阶段 */
  phase: GamePhase;
  /** 回合数 */
  turnCount: number;
  /** 游戏是否结束 */
  isGameOver: boolean;
  /** 底牌数量 */
  remainingDeckCards: number;
  /** 当前回合可以执行的操作 */
  availableActions: AvailableAction[];
  /** 收集的玩家响应（用于仲裁） */
  pendingResponses: PlayerResponse[];
  /** 待响应牌来源：出牌或翻牌 */
  pendingCardSource?: 'discard' | 'draw';
  /** 核心管理的显式响应生命周期；非响应阶段不存在 */
  responseWindow?: ResponseWindow;
  /** 是否因本次招牌触发免出牌 */
  skipDiscardAfterZhao?: boolean;
  /** 胜利者索引 */
  winnerIndex?: number;
  /** 胡牌方式 */
  winType?: WinType;
  /** 点炮者索引（如果是点炮胡） */
  dianpaoPlayerIndex?: number;
  /** 本次胡牌名堂 */
  winningMingTangs?: MingTang[];
  /** 本次胡牌总番数 */
  totalFans?: number;
  /** 本次胡牌基础胡息 */
  winningHuPoints?: number;
  /** 本次胡牌基础分 */
  winningBaseScore?: number;
  /** 本次单局计分 */
  winningRoundScore?: number;
  /** 进入爆牌选择的玩家索引列表 */
  baoEligiblePlayerIndices?: number[];
  /** 当前爆牌选择队列位置 */
  baoDecisionIndex?: number;
  /** 爆牌选择历史 */
  baoDecisions?: BaoDecisionRecord[];
  /** 庄家开局待处理的第21张牌 */
  dealerPendingCard?: Card;
  /** 开局子阶段，显式区分爆牌选择、庄家 pending 解析和正常流程。 */
  openingPhase?: OpeningPhase;
  /** 开局事实快照，供天胡/水上漂结算使用。 */
  openingFacts?: OpeningFacts;
  /** 已从牌山真实翻出的牌数量；pending card 不计入。 */
  drawOrdinal?: number;
  /** 本局使用的规则版本。 */
  ruleVersion?: string;
  /** 本局冻结的规则 profile 快照。 */
  ruleProfile?: RuleProfile;
}

export interface DiscardEvent {
  card: Card;
  source: 'discard' | 'draw';
  sourcePlayerIndex: number;
  responseWindowId?: string;
  sequence: number;
  /** 旧 replay 展示兼容字段；新事件以 sourcePlayerIndex 为准。 */
  playerIndex?: number;
}

/**
 * 可用的操作
 */
export interface AvailableAction {
  type: 'discard' | 'draw' | 'peng' | 'zhao' | 'chi' | 'hu' | 'pass' | 'bao' | 'pass_bao';
  /** 操作涉及的牌 */
  cards: Card[];
  /** 吃牌多方案候选 */
  chiOptions?: ChiOption[];
  /** 胡牌时若依赖吃牌落地，则携带可直接成胡的吃牌方案 */
  huOptions?: ChiOption[];
  /** 是否为强制操作 */
  isMandatory: boolean;
  /** 操作描述 */
  description: string;
}

/**
 * 出牌建议
 */
export interface PlayRecommendation {
  /** 操作类型 */
  action: 'discard' | 'meld' | 'draw' | 'pass';
  /** 要出的牌 */
  card?: Card;
  /** 要组合的牌型 */
  meldType?: MeldType;
  /** 组合涉及的牌 */
  meldCards?: Card[];
  /** 理由 */
  reasoning: string;
  /** 胜率 */
  winRate: number;
  /** 预期得分 */
  expectedScore: number;
  /** 风险等级 */
  riskLevel: 'low' | 'medium' | 'high';
  /** 优先级 (越高越推荐) */
  priority: number;
}

/**
 * 游戏规则验证器接口
 */
export interface RulesValidator {
  /** 验证牌型是否有效 */
  isValidMeld(cards: Card[], type: MeldType): boolean;

  /** 检查是否可以吃牌 */
  canChi(handCards: Card[], targetCard: Card): boolean;

  /** 检查是否可以碰牌 */
  canPeng(handCards: Card[], targetCard: Card): boolean;

  /** 检查是否可以招牌 */
  canZhao(handCards: Card[], targetCard: Card): boolean;

  /** 检查是否可以胡牌（activeCard用于响应阶段） */
  canHu(handCards: Card[], melds: Meld[], activeCard?: Card): boolean;

  /** 检查是否可以胜利 */
  checkCanWin(
    remainingCards: Card[],
    melds: Meld[],
    totalHuPoints: number,
    profile?: Pick<RuleProfile, 'minHuPoints' | 'allowZeroHu'>,
  ): boolean;

  /** 获取强制操作 */
  getMandatoryActions(state: GameState): AvailableAction[];

  /** 检查是否形成八块 */
  hasEightBlocks(melds: Meld[]): boolean;
}

/**
 * 过张记录 - 记录玩家放弃过的吃牌机会
 */
export interface PassedPlay {
  /** 放弃的牌 */
  card: Card;
  /** 放弃的时间戳 */
  timestamp: number;
  /** 放弃的操作类型 */
  actionType: 'chi' | 'peng' | 'hu' | 'discard';
}

/**
 * 冻结的规则 profile：所有会改变牌局语义的可变字段只从这里进入新局。
 */
export interface RuleProfile {
  ruleVersion: string;
  playerCount: 3;
  bottomCardCount: 0 | 1 | 2;
  enabledMingTangTypes: EnabledMingTangMap;
  guoZhangClearPolicy: 'ROUND_END' | 'AFTER_SELF_ACTION' | 'NEVER';
  rotatingDealer: boolean;
  mandatoryPeng: boolean;
  mandatoryZhao: boolean;
  minHuPoints: number;
  allowZeroHu: boolean;
  maxTurns?: number;
  /** R6.3.1: 响应窗口默认10秒 */
  responseTimeout: 10000,
  /** R6.3.2: 最小3秒 */
  minResponseTimeout: 3000,
  /** R6.3.2: 最大30秒 */
  maxResponseTimeout: number;
};

export const DEFAULT_RULE_PROFILE: Readonly<RuleProfile> = Object.freeze({
  ruleVersion: 'luzhou-daer-rules-v2.4',
  playerCount: 3,
  bottomCardCount: 2,
  enabledMingTangTypes: Object.freeze({ ...DEFAULT_ENABLED_MINGTANG_TYPES }) as EnabledMingTangMap,
  guoZhangClearPolicy: 'NEVER',
  rotatingDealer: true,
  mandatoryPeng: true,
  mandatoryZhao: true,
  minHuPoints: 10,
  allowZeroHu: true,
  maxTurns: 200,
  responseTimeout: 10000,
  minResponseTimeout: 3000,
  maxResponseTimeout: 30000,
});

/** 游戏配置只附带种子和上一局结果，不重复定义规则语义。 */
export interface GameConfig extends RuleProfile {
  seed?: number;
  lastDealerIndex?: number;
  lastGameDrawn?: boolean;
  lastWinnerIndex?: number;
}

export const DEFAULT_GAME_CONFIG: GameConfig = {
  ...DEFAULT_RULE_PROFILE,
  enabledMingTangTypes: { ...DEFAULT_RULE_PROFILE.enabledMingTangTypes },
};
