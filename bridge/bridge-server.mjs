// scripts/godot-ai-runtime-server.ts
import { createServer } from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

// src/shared/types/card.ts
var CardFactory = class {
  static {
    this.idCounter = 0;
  }
  /**
   * 创建单张牌
   */
  static create(rank, size) {
    const value = this.getNumericValue(rank);
    const isRed = this.isRedCard(value);
    const color = isRed ? "red" /* RED */ : "black" /* BLACK */;
    return {
      id: `card_${rank}_${size}_${++this.idCounter}`,
      rank,
      size,
      color,
      value,
      isRed
    };
  }
  /**
   * 获取数字值
   */
  static getNumericValue(rank) {
    const valueMap = {
      "\u4E00": 1,
      "\u4E8C": 2,
      "\u4E09": 3,
      "\u56DB": 4,
      "\u4E94": 5,
      "\u516D": 6,
      "\u4E03": 7,
      "\u516B": 8,
      "\u4E5D": 9,
      "\u5341": 10,
      "\u58F9": 1,
      "\u8D30": 2,
      "\u53C1": 3,
      "\u8086": 4,
      "\u4F0D": 5,
      "\u9646": 6,
      "\u67D2": 7,
      "\u634C": 8,
      "\u7396": 9,
      "\u62FE": 10
    };
    return valueMap[rank];
  }
  /**
   * 判断是否为红牌 (2/7/10)
   */
  static isRedCard(value) {
    return value === 2 || value === 7 || value === 10;
  }
  /**
   * 创建完整牌组 (80张)
   */
  static createDeck() {
    const deck = [];
    const ranks = [
      "\u4E00",
      "\u4E8C",
      "\u4E09",
      "\u56DB",
      "\u4E94",
      "\u516D",
      "\u4E03",
      "\u516B",
      "\u4E5D",
      "\u5341",
      "\u58F9",
      "\u8D30",
      "\u53C1",
      "\u8086",
      "\u4F0D",
      "\u9646",
      "\u67D2",
      "\u634C",
      "\u7396",
      "\u62FE"
    ];
    const sizes = ["small" /* SMALL */, "big" /* BIG */];
    for (const rank of ranks) {
      for (const size of sizes) {
        for (let i = 0; i < 4; i++) {
          deck.push(this.create(rank, size));
        }
      }
    }
    return deck;
  }
  /**
   * 重置ID计数器
   */
  static resetIdCounter() {
    this.idCounter = 0;
  }
  /**
   * 洗牌
   */
  static shuffle(deck) {
    const shuffled = [...deck];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
  }
};
var CardComparator = class {
  /**
   * 判断两张牌是否相同（等级和大小写都相同）
   */
  static isSame(a, b) {
    return a.rank === b.rank && a.size === b.size;
  }
  /**
   * 判断两张牌是否等值（等级相同，忽略大小写）
   */
  static isEquivalent(a, b) {
    return a.value === b.value;
  }
  /**
   * 判断是否为大小混搭（2张相同大写+1张同数字小写，或反之）
   */
  static isMixedSize(cards) {
    if (cards.length !== 3) return false;
    const values = cards.map((c) => c.value);
    return values.every((v) => v === values[0]) && new Set(cards.map((c) => c.size)).size === 2;
  }
};

// src/shared/types/game.ts
var DEFAULT_ENABLED_MINGTANG_TYPES = {
  ["qia" /* QIA */]: true,
  ["luan" /* LUAN */]: true,
  ["hong" /* HONG */]: true,
  ["hei" /* HEI */]: true,
  ["tian_hu" /* TIAN_HU */]: true,
  ["shui_shang_piao" /* SHUI_SHANG_PIAO */]: true,
  ["hai_di_lao" /* HAI_DI_LAO */]: true,
  ["kun" /* KUN */]: true,
  ["gui" /* GUI */]: true,
  ["zi_mo" /* ZI_MO */]: true,
  ["bao" /* BAO */]: true,
  ["sha_bao" /* SHA_BAO */]: true
};
var RESPONSE_PRIORITY = {
  hu: 1,
  zhao: 2,
  peng: 3,
  chi: 4,
  pass: 99
};
var DEFAULT_RULE_PROFILE = Object.freeze({
  ruleVersion: "luzhou-daer-rules-v2.4",
  playerCount: 3,
  bottomCardCount: 2,
  enabledMingTangTypes: Object.freeze({ ...DEFAULT_ENABLED_MINGTANG_TYPES }),
  guoZhangClearPolicy: "NEVER",
  rotatingDealer: true,
  mandatoryPeng: true,
  mandatoryZhao: true,
  minHuPoints: 10,
  allowZeroHu: true,
  maxTurns: 200,
  responseTimeout: 1e4,
  minResponseTimeout: 3e3,
  maxResponseTimeout: 3e4
});
var DEFAULT_GAME_CONFIG = {
  ...DEFAULT_RULE_PROFILE,
  enabledMingTangTypes: { ...DEFAULT_RULE_PROFILE.enabledMingTangTypes }
};

// src/shared/constants/cards.ts
var SMALL_RANKS = [
  "\u4E00",
  "\u4E8C",
  "\u4E09",
  "\u56DB",
  "\u4E94",
  "\u516D",
  "\u4E03",
  "\u516B",
  "\u4E5D",
  "\u5341"
];
var BIG_RANKS = [
  "\u58F9",
  "\u8D30",
  "\u53C1",
  "\u8086",
  "\u4F0D",
  "\u9646",
  "\u67D2",
  "\u634C",
  "\u7396",
  "\u62FE"
];
var ALL_RANKS = [
  ...SMALL_RANKS,
  ...BIG_RANKS
];
var DEAL_CONFIG = {
  /** 固定三人游戏 */
  THREE_PLAYERS: {
    /** 庄家牌数 */
    DEALER_CARDS: 21,
    /** 闲家牌数 */
    PLAYER_CARDS: 20,
    /** 底牌数 */
    BOTTOM_CARDS: 2,
    /** 可摸牌数 */
    DRAWABLE_CARDS: 17,
    /** 总发牌数 */
    TOTAL_DEALT: 21 + 20 * 2
  }
};

// src/shared/constants/scoring.ts
var HU_POINTS_TABLE = {
  ["pair" /* PAIR */]: {
    blackSmall: 0,
    redSmall: 0,
    blackBig: 0,
    redBig: 0
  },
  ["peng" /* PENG */]: {
    blackSmall: 1,
    redSmall: 6,
    blackBig: 3,
    redBig: 9
  },
  ["triple" /* TRIPLE */]: {
    blackSmall: 6,
    redSmall: 9,
    blackBig: 9,
    redBig: 12
  },
  ["draw_quadruple" /* DRAW_QUADRUPLE */]: {
    blackSmall: 9,
    redSmall: 12,
    blackBig: 12,
    redBig: 15
  },
  ["quadruple" /* QUADRUPLE */]: {
    blackSmall: 12,
    redSmall: 15,
    blackBig: 15,
    redBig: 18
  },
  ["sequence" /* SEQUENCE */]: {
    blackSmall: 0,
    redSmall: 0,
    blackBig: 0,
    redBig: 0
  },
  ["special_2710" /* SPECIAL_2710 */]: {
    blackSmall: 0,
    redSmall: 6,
    blackBig: 0,
    redBig: 9
  },
  ["mixed_size" /* MIXED_SIZE */]: {
    blackSmall: 0,
    redSmall: 0,
    blackBig: 0,
    redBig: 0
  }
};
var SPECIAL_SEQUENCE_HU = {
  small123: 3,
  small2710: 6,
  big123: 6,
  big2710: 9
};
function getHuPoints(meldType, cardInfo) {
  const table = HU_POINTS_TABLE[meldType];
  if (cardInfo.size === "small" /* SMALL */) {
    return cardInfo.color === "red" /* RED */ ? table.redSmall : table.blackSmall;
  } else {
    return cardInfo.color === "red" /* RED */ ? table.redBig : table.blackBig;
  }
}
function getSpecialSequenceHu(ranks, size) {
  const isSmall = size === "small" /* SMALL */;
  if (isSmall && ranks.join("") === "\u4E00\u4E8C\u4E09") {
    return SPECIAL_SEQUENCE_HU.small123;
  }
  if (isSmall && ranks.sort().join("") === "\u4E8C\u5341\u4E03") {
    return SPECIAL_SEQUENCE_HU.small2710;
  }
  if (!isSmall && ranks.join("") === "\u58F9\u8D30\u53C1") {
    return SPECIAL_SEQUENCE_HU.big123;
  }
  if (!isSmall && ranks.sort().join("") === "\u8D30\u67D2\u62FE") {
    return SPECIAL_SEQUENCE_HU.big2710;
  }
  return null;
}
var WIN_CONDITIONS = {
  MIN_HU_POINTS: 10,
  ALLOW_ZERO_HU: true,
  REQUIRED_MELDS: 7,
  HEAVENLY_WIN_CONDITIONS: {
    threeQuadruples: 3,
    fourTriples: 4
  }
};
var MING_TANG_FAN_TABLE = {
  ["qia" /* QIA */]: {
    name: "\u6070",
    fan: 1,
    description: "\u80E1\u606F\u6B63\u597D\u4E3A\u6574\u5341\u6570\uFF0C\u598210/20/30/40\u80E1"
  },
  ["luan" /* LUAN */]: {
    name: "\u4E71",
    fan: 1,
    description: "\u80E1\u724C\u65F6\u603B\u80E1\u606F\u4E3A0"
  },
  ["hong" /* HONG */]: {
    name: "\u7EA2",
    fan: 1,
    description: "\u80E1\u724C\u540E\u6240\u6709\u724C\u4E2D\u7EA2\u724C\u6570\u91CF\u4E0D\u5C11\u4E8E10\u5F20"
  },
  ["hei" /* HEI */]: {
    name: "\u9ED1",
    fan: 3,
    description: "\u80E1\u724C\u540E\u6240\u6709\u724C\u4E2D\u6CA1\u6709\u7EA2\u724C\uFF08\u5168\u9ED1\uFF09"
  },
  ["tian_hu" /* TIAN_HU */]: {
    name: "\u5929\u80E1",
    fan: 1,
    description: "\u53D1\u5B8C\u724C\u540E\u5E84\u5BB6\u5373\u80E1\u724C"
  },
  ["shui_shang_piao" /* SHUI_SHANG_PIAO */]: {
    name: "\u6C34\u4E0A\u6F02",
    fan: 1,
    description: "\u54CD\u5E94\u724C\u5C71\u7FFB\u51FA\u7684\u7B2C\u4E00\u5F20\u724C\u5373\u80E1\u724C"
  },
  ["hai_di_lao" /* HAI_DI_LAO */]: {
    name: "\u6D77\u5E95\u635E",
    fan: 1,
    description: "\u54CD\u5E94\u724C\u5C71\u7FFB\u51FA\u7684\u6700\u540E\u4E00\u5F20\u724C\u80E1\u724C"
  },
  ["kun" /* KUN */]: {
    name: "\u6606",
    fan: 1,
    description: "\u9664\u5C06\u724C\u5916\uFF0C\u6240\u6709\u724C\u7EC4\u90FD\u6709\u80E1\u606F"
  },
  ["gui" /* GUI */]: {
    name: "\u5F52",
    fan: 1,
    description: "\u6BCF\u51FA\u73B01\u7EC4\u56DB\u5F20\u540C\u6837\u7684\u724C\u8BA11\u756A"
  },
  ["zi_mo" /* ZI_MO */]: {
    name: "\u81EA\u6478",
    fan: 1,
    description: "\u73A9\u5BB6\u81EA\u5DF1\u7684\u8F6E\u6B21\u7FFB\u724C\u54CD\u5E94\u80E1\u724C"
  },
  ["bao" /* BAO */]: {
    name: "\u7206",
    fan: 1,
    description: "\u5F00\u5C4020\u5F20\u542C\u724C\u540E\u9009\u62E9\u7206\u724C\uFF0C\u5E76\u4EE5\u7206\u724C\u72B6\u6001\u80E1\u724C"
  },
  ["sha_bao" /* SHA_BAO */]: {
    name: "\u6740\u7206",
    fan: 1,
    description: "\u9664\u80E1\u724C\u73A9\u5BB6\u5916\uFF0C\u5176\u4F59\u5BA3\u7206\u73A9\u5BB6\u5F62\u6210\u6740\u7206"
  }
};
var BASE_SCORE_TABLE = {
  ZERO_HU: 2,
  TEN_TO_NINETEEN: 2,
  TWENTY_TO_TWENTY_NINE: 3,
  THIRTY_TO_THIRTY_NINE: 4,
  FORTY_PLUS: 5
};
var BASE_FAN = 1;
function getBaseScoreByHu(totalHuPoints) {
  if (totalHuPoints === 0) {
    return BASE_SCORE_TABLE.ZERO_HU;
  }
  if (totalHuPoints < 20) {
    return BASE_SCORE_TABLE.TEN_TO_NINETEEN;
  }
  if (totalHuPoints < 30) {
    return BASE_SCORE_TABLE.TWENTY_TO_TWENTY_NINE;
  }
  if (totalHuPoints < 40) {
    return BASE_SCORE_TABLE.THIRTY_TO_THIRTY_NINE;
  }
  return BASE_SCORE_TABLE.FORTY_PLUS;
}
function checkWinCondition(totalHuPoints, groupCount, pairCount, isZeroHu) {
  const validStructure = groupCount === WIN_CONDITIONS.REQUIRED_MELDS && pairCount === 0 || groupCount === WIN_CONDITIONS.REQUIRED_MELDS - 1 && pairCount === 1;
  if (!validStructure) {
    return false;
  }
  if (isZeroHu) {
    return WIN_CONDITIONS.ALLOW_ZERO_HU && totalHuPoints === 0;
  }
  return totalHuPoints >= WIN_CONDITIONS.MIN_HU_POINTS && validStructure;
}
var EIGHT_BLOCKS_CONFIG = {
  REQUIRED_COUNT: 2,
  SKIP_DISCARD: true,
  PRIVILEGE_ACTIVE: true
};
function hasEightBlocks(quadrupleCount, drawQuadrupleCount) {
  return quadrupleCount + drawQuadrupleCount >= EIGHT_BLOCKS_CONFIG.REQUIRED_COUNT;
}

// src/shared/constants/melds.ts
var MELD_DEFINITIONS = {
  /** 对子 - 2张相同 */
  ["pair" /* PAIR */]: {
    name: "\u5BF9\u5B50",
    cardCount: 2,
    description: "2\u5F20\u4E00\u6A21\u4E00\u6837\u7684\u724C"
  },
  /** 碰牌 - 桌面3张相同 */
  ["peng" /* PENG */]: {
    name: "\u78B0\u724C",
    cardCount: 3,
    description: "\u684C\u97623\u5F20\u76F8\u540C\u7684\u724C"
  },
  /** 坎牌 - 起手3张相同，固定不可拆 */
  ["triple" /* TRIPLE */]: {
    name: "\u574E\u724C",
    cardCount: 3,
    description: "\u8D77\u624B\u5C31\u6709\u76843\u5F20\u4E00\u6A21\u4E00\u6837\u7684\u724C\uFF08\u56FA\u5B9A\u7EC4\u5408\uFF0C\u7EDD\u5BF9\u4E0D\u80FD\u62C6\u6563\uFF09"
  },
  /** 垅牌 - 起手4张相同，必须晒出 */
  ["quadruple" /* QUADRUPLE */]: {
    name: "\u5785\u724C",
    cardCount: 4,
    description: "\u8D77\u624B\u5C31\u6709\u76844\u5F20\u4E00\u6A21\u4E00\u6837\u7684\u724C\uFF08\u5FC5\u987B\u653E\u5728\u684C\u9762\u793A\u4F17\uFF09",
    isMandatory: true
  },
  /** 招牌 - 已有3张，摸到第4张 */
  ["draw_quadruple" /* DRAW_QUADRUPLE */]: {
    name: "\u62DB\u724C",
    cardCount: 4,
    description: "\u624B\u4E2D\u5DF2\u6709\u574E\u724C\uFF0C\u5F53\u522B\u4EBA\u6253\u51FA\u6216\u6478\u51FA\u7B2C4\u5F20\u65F6\u5FC5\u987B\u62DB\u724C",
    isMandatory: true
  },
  /** 列牌 - 3张顺子 */
  ["sequence" /* SEQUENCE */]: {
    name: "\u5217\u724C",
    cardCount: 3,
    description: "3\u5F20\u76F8\u90BB\u7684\u724C\uFF08\u5982\uFF1A\u5C0F\u56DB\u4E94\u516D\uFF09"
  },
  /** 特殊组合 - 2/7/10 */
  ["special_2710" /* SPECIAL_2710 */]: {
    name: "\u4E8C\u4E03\u5341",
    cardCount: 3,
    description: "2\u30017\u300110\u7EC4\u5408\uFF08\u5FC5\u987B\u540C\u4E3A\u5927\u5199\u6216\u540C\u4E3A\u5C0F\u5199\uFF09"
  },
  /** 大小混搭 */
  ["mixed_size" /* MIXED_SIZE */]: {
    name: "\u5927\u5C0F\u6DF7\u642D",
    cardCount: 3,
    description: "2\u5F20\u76F8\u540C\u7684\u5927\u724C+1\u5F20\u540C\u6570\u5B57\u7684\u5C0F\u724C\uFF0C\u6216\u53CD\u4E4B"
  }
};
var MANDATORY_MELDS = [
  "quadruple" /* QUADRUPLE */,
  "draw_quadruple" /* DRAW_QUADRUPLE */
];
var HEAVENLY_WIN = {
  /** 3个垅牌 */
  THREE_QUADRUPLES: 3,
  /** 4个坎牌 */
  FOUR_TRIPLES: 4
};
function isHeavenlyWin(quadrupleCount, tripleCount) {
  return quadrupleCount >= HEAVENLY_WIN.THREE_QUADRUPLES || tripleCount >= HEAVENLY_WIN.FOUR_TRIPLES;
}

// src/game-engine/deck-manager.ts
var SMALL_RANKS2 = ["\u4E00", "\u4E8C", "\u4E09", "\u56DB", "\u4E94", "\u516D", "\u4E03", "\u516B", "\u4E5D", "\u5341"];
var BIG_RANKS2 = ["\u58F9", "\u8D30", "\u53C1", "\u8086", "\u4F0D", "\u9646", "\u67D2", "\u634C", "\u7396", "\u62FE"];
function getNumericValue(rank) {
  const valueMap = {
    "\u4E00": 1,
    "\u4E8C": 2,
    "\u4E09": 3,
    "\u56DB": 4,
    "\u4E94": 5,
    "\u516D": 6,
    "\u4E03": 7,
    "\u516B": 8,
    "\u4E5D": 9,
    "\u5341": 10,
    "\u58F9": 1,
    "\u8D30": 2,
    "\u53C1": 3,
    "\u8086": 4,
    "\u4F0D": 5,
    "\u9646": 6,
    "\u67D2": 7,
    "\u634C": 8,
    "\u7396": 9,
    "\u62FE": 10
  };
  return valueMap[rank];
}
function isRedCard2(value) {
  return value === 2 || value === 7 || value === 10;
}
var DeckManager = class {
  constructor() {
    this.idCounter = 0;
  }
  /**
   * 创建标准80张牌组
   */
  createDeck() {
    const deck = [];
    this.idCounter = 0;
    for (const rank of SMALL_RANKS2) {
      for (let i = 0; i < 4; i++) {
        const value = getNumericValue(rank);
        deck.push({
          id: `card_${rank}_small_${++this.idCounter}`,
          rank,
          size: "small" /* SMALL */,
          color: isRedCard2(value) ? "red" /* RED */ : "black" /* BLACK */,
          value,
          isRed: isRedCard2(value)
        });
      }
    }
    for (const rank of BIG_RANKS2) {
      for (let i = 0; i < 4; i++) {
        const value = getNumericValue(rank);
        deck.push({
          id: `card_${rank}_big_${++this.idCounter}`,
          rank,
          size: "big" /* BIG */,
          color: isRedCard2(value) ? "red" /* RED */ : "black" /* BLACK */,
          value,
          isRed: isRedCard2(value)
        });
      }
    }
    return deck;
  }
  /**
   * 洗牌（Fisher-Yates算法）
   */
  shuffle(deck) {
    const shuffled = [...deck];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
  }
  /**
   * 洗牌（带种子，用于可重现的模拟）
   */
  shuffleWithSeed(deck, seed) {
    const shuffled = [...deck];
    let random = this.seededRandom(seed);
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
  }
  /**
   * 带种子的随机数生成器（简单的线性同余生成器）
   */
  seededRandom(seed) {
    return () => {
      seed = (seed * 9301 + 49297) % 233280;
      return seed / 233280;
    };
  }
  /**
   * 发牌
   */
  deal(deck, playerCount, dealerIndex = 0, bottomCardCountOverride, holdDealerPendingCard = false) {
    if (playerCount !== 3) {
      throw new Error("Only three-player games are supported.");
    }
    const config = DEAL_CONFIG.THREE_PLAYERS;
    const hands = [];
    let cardIndex = 0;
    let dealerPendingCard;
    for (let i = 0; i < 3; i++) {
      const isDealer = i === dealerIndex;
      const cardCount = isDealer ? holdDealerPendingCard ? config.PLAYER_CARDS : config.DEALER_CARDS : config.PLAYER_CARDS;
      const hand = [];
      for (let j = 0; j < cardCount; j++) {
        if (cardIndex < deck.length) {
          hand.push(deck[cardIndex++]);
        }
      }
      hand.sort((a, b) => {
        if (a.size !== b.size) {
          return a.size === "big" ? 1 : -1;
        }
        if (a.value !== b.value) {
          return a.value - b.value;
        }
        return 0;
      });
      hands.push(hand);
    }
    if (holdDealerPendingCard && dealerIndex >= 0 && dealerIndex < 3 && cardIndex < deck.length) {
      dealerPendingCard = deck[cardIndex++];
    }
    const remainingAfterDeal = deck.slice(cardIndex);
    const bottomCardCount = bottomCardCountOverride ?? config.BOTTOM_CARDS;
    const drawableDeck = bottomCardCount === 0 ? remainingAfterDeal : remainingAfterDeal.slice(0, -bottomCardCount);
    return {
      hands,
      dealerIndex,
      remainingDeck: drawableDeck,
      dealerPendingCard
    };
  }
  /**
   * 从牌堆摸一张牌
   */
  draw(deck) {
    return deck.pop() ?? null;
  }
  /**
   * 获取剩余牌数
   */
  remainingCount(deck) {
    return deck.length;
  }
  /**
   * 检查牌堆是否为空
   */
  isEmpty(deck) {
    return deck.length === 0;
  }
  /**
   * 创建一副洗好的牌
   */
  createShuffledDeck() {
    const deck = this.createDeck();
    return this.shuffle(deck);
  }
  /**
   * 创建一副洗好的牌（带种子）
   */
  createShuffledDeckWithSeed(seed) {
    const deck = this.createDeck();
    return this.shuffleWithSeed(deck, seed);
  }
};
var deckManager = new DeckManager();

// src/game-engine/meld-detector.ts
var MeldDetector = class {
  /**
   * 检测所有可能的牌型
   */
  detectAllMelds(cards) {
    const melds = [];
    let remaining = [...cards];
    const quadruples = this.detectQuadruples(remaining);
    melds.push(...quadruples.melds);
    remaining = quadruples.remaining;
    const triples = this.detectTriples(remaining);
    melds.push(...triples.melds);
    remaining = triples.remaining;
    const sequences = this.detectSequences(remaining);
    melds.push(...sequences.melds);
    remaining = sequences.remaining;
    const special2710 = this.detectSpecial2710(remaining);
    melds.push(...special2710.melds);
    remaining = special2710.remaining;
    const mixedSize = this.detectMixedSize(remaining);
    melds.push(...mixedSize.melds);
    remaining = mixedSize.remaining;
    const pairs = this.detectPairs(remaining);
    melds.push(...pairs.melds);
    return melds;
  }
  /**
   * 检测垅牌 (起手4张相同)
   */
  detectQuadruples(cards) {
    const melds = [];
    const remaining = [];
    const used = /* @__PURE__ */ new Set();
    for (const card of cards) {
      if (used.has(card.id)) continue;
      const sameCards = cards.filter(
        (c) => !used.has(c.id) && CardComparator.isSame(card, c)
      );
      if (sameCards.length >= 4) {
        const meldCards = sameCards.slice(0, 4);
        meldCards.forEach((c) => used.add(c.id));
        melds.push({
          type: "quadruple" /* QUADRUPLE */,
          cards: meldCards,
          isConcealed: true,
          position: "hand",
          huPoints: 0
        });
      }
    }
    cards.forEach((c) => {
      if (!used.has(c.id)) {
        remaining.push(c);
      }
    });
    return { melds, remaining };
  }
  /**
   * 检测坎牌 (3张相同)
   */
  detectTriples(cards) {
    const melds = [];
    const remaining = [];
    const used = /* @__PURE__ */ new Set();
    for (const card of cards) {
      if (used.has(card.id)) continue;
      const sameCards = cards.filter(
        (c) => !used.has(c.id) && CardComparator.isSame(card, c)
      );
      if (sameCards.length >= 3) {
        const meldCards = sameCards.slice(0, 3);
        meldCards.forEach((c) => used.add(c.id));
        melds.push({
          type: "triple" /* TRIPLE */,
          cards: meldCards,
          isConcealed: true,
          position: "hand",
          huPoints: 0
        });
      }
    }
    cards.forEach((c) => {
      if (!used.has(c.id)) {
        remaining.push(c);
      }
    });
    return { melds, remaining };
  }
  /**
   * 检测对子 (2张相同)
   */
  detectPairs(cards) {
    const melds = [];
    const remaining = [];
    const used = /* @__PURE__ */ new Set();
    for (const card of cards) {
      if (used.has(card.id)) continue;
      const sameCard = cards.find(
        (c) => !used.has(c.id) && c.id !== card.id && CardComparator.isSame(card, c)
      );
      if (sameCard) {
        used.add(card.id);
        used.add(sameCard.id);
        melds.push({
          type: "pair" /* PAIR */,
          cards: [card, sameCard],
          isConcealed: true,
          position: "hand",
          huPoints: 0
        });
      }
    }
    cards.forEach((c) => {
      if (!used.has(c.id)) {
        remaining.push(c);
      }
    });
    return { melds, remaining };
  }
  /**
   * 检测列牌 (顺子)
   */
  detectSequences(cards) {
    const melds = [];
    const remaining = [];
    const used = /* @__PURE__ */ new Set();
    const smallCards = cards.filter((c) => c.size === "small" /* SMALL */ && !used.has(c.id));
    const bigCards = cards.filter((c) => c.size === "big" /* BIG */ && !used.has(c.id));
    const smallSequences = this.detectSequencesBySize(smallCards, "small" /* SMALL */);
    smallSequences.melds.forEach((m) => {
      m.cards.forEach((c) => used.add(c.id));
      melds.push(m);
    });
    const bigSequences = this.detectSequencesBySize(bigCards, "big" /* BIG */);
    bigSequences.melds.forEach((m) => {
      m.cards.forEach((c) => used.add(c.id));
      melds.push(m);
    });
    cards.forEach((c) => {
      if (!used.has(c.id)) {
        remaining.push(c);
      }
    });
    return { melds, remaining };
  }
  /**
   * 按大小写检测顺子
   */
  detectSequencesBySize(cards, _size) {
    const melds = [];
    const used = /* @__PURE__ */ new Set();
    const byValue = /* @__PURE__ */ new Map();
    for (const card of cards) {
      if (!byValue.has(card.value)) {
        byValue.set(card.value, []);
      }
      byValue.get(card.value).push(card);
    }
    for (let start = 1; start <= 8; start++) {
      const v1 = byValue.get(start);
      const v2 = byValue.get(start + 1);
      const v3 = byValue.get(start + 2);
      if (v1 && v1.length > 0 && !used.has(v1[0].id) && v2 && v2.length > 0 && !used.has(v2[0].id) && v3 && v3.length > 0 && !used.has(v3[0].id)) {
        const meldCards = [v1[0], v2[0], v3[0]];
        meldCards.forEach((c) => used.add(c.id));
        melds.push({
          type: "sequence" /* SEQUENCE */,
          cards: meldCards,
          isConcealed: true,
          position: "hand",
          huPoints: 0
        });
      }
    }
    return { melds, remaining: cards.filter((c) => !used.has(c.id)) };
  }
  /**
   * 检测特殊组合 (2/7/10)
   */
  detectSpecial2710(cards) {
    const melds = [];
    const remaining = [];
    const used = /* @__PURE__ */ new Set();
    const smallCards = cards.filter((c) => c.size === "small" /* SMALL */);
    const bigCards = cards.filter((c) => c.size === "big" /* BIG */);
    const smallSpecial = this.detectSpecial2710BySize(smallCards, "small" /* SMALL */);
    smallSpecial.melds.forEach((m) => {
      m.cards.forEach((c) => used.add(c.id));
      melds.push(m);
    });
    const bigSpecial = this.detectSpecial2710BySize(bigCards, "big" /* BIG */);
    bigSpecial.melds.forEach((m) => {
      m.cards.forEach((c) => used.add(c.id));
      melds.push(m);
    });
    cards.forEach((c) => {
      if (!used.has(c.id)) {
        remaining.push(c);
      }
    });
    return { melds, remaining };
  }
  /**
   * 按大小写检测 2/7/10
   */
  detectSpecial2710BySize(cards, _size) {
    const melds = [];
    const used = /* @__PURE__ */ new Set();
    const two = cards.find((c) => c.value === 2 && !used.has(c.id));
    const seven = cards.find((c) => c.value === 7 && !used.has(c.id));
    const ten = cards.find((c) => c.value === 10 && !used.has(c.id));
    if (two && seven && ten) {
      used.add(two.id);
      used.add(seven.id);
      used.add(ten.id);
      melds.push({
        type: "special_2710" /* SPECIAL_2710 */,
        cards: [two, seven, ten],
        isConcealed: true,
        position: "hand",
        huPoints: 0
      });
    }
    return { melds, remaining: cards.filter((c) => !used.has(c.id)) };
  }
  /**
   * 检测大小混搭
   */
  detectMixedSize(cards) {
    const melds = [];
    const remaining = [];
    const used = /* @__PURE__ */ new Set();
    const byValue = /* @__PURE__ */ new Map();
    for (const card of cards) {
      if (!byValue.has(card.value)) {
        byValue.set(card.value, { small: [], big: [] });
      }
      if (card.size === "small" /* SMALL */) {
        byValue.get(card.value).small.push(card);
      } else {
        byValue.get(card.value).big.push(card);
      }
    }
    for (const [, group] of byValue.entries()) {
      if (group.big.length >= 2 && group.small.length >= 1) {
        const meldCards = [group.big[0], group.big[1], group.small[0]];
        meldCards.forEach((c) => used.add(c.id));
        melds.push({
          type: "mixed_size" /* MIXED_SIZE */,
          cards: meldCards,
          isConcealed: true,
          position: "hand",
          huPoints: 0
        });
      } else if (group.small.length >= 2 && group.big.length >= 1) {
        const meldCards = [group.small[0], group.small[1], group.big[0]];
        meldCards.forEach((c) => used.add(c.id));
        melds.push({
          type: "mixed_size" /* MIXED_SIZE */,
          cards: meldCards,
          isConcealed: true,
          position: "hand",
          huPoints: 0
        });
      }
    }
    cards.forEach((c) => {
      if (!used.has(c.id)) {
        remaining.push(c);
      }
    });
    return { melds, remaining };
  }
  /**
   * 统计手牌
   */
  calculateStats(cards) {
    const pairs = this.detectPairs(cards).melds.length;
    const triples = this.detectTriples(cards).melds.length;
    const quadruples = this.detectQuadruples(cards).melds.length;
    const sequences = this.detectSequences(cards).melds.length;
    const special2710 = this.detectSpecial2710(cards).melds.length;
    return { pairs, triples, quadruples, sequences, special2710 };
  }
};

// src/game-engine/score-calculator.ts
var ScoreCalculator = class {
  buildMingTang(type) {
    const definition = MING_TANG_FAN_TABLE[type];
    return {
      type,
      name: definition.name,
      fan: definition.fan,
      description: definition.description
    };
  }
  isMingTangEnabled(type, enabledMingTangTypes) {
    const enabled = enabledMingTangTypes || DEFAULT_ENABLED_MINGTANG_TYPES;
    return enabled[type] !== false;
  }
  getAllCardsFromMelds(melds) {
    return melds.flatMap((meld) => meld.cards || []);
  }
  countGui(cards) {
    const grouped = /* @__PURE__ */ new Map();
    for (const card of cards) {
      const key = `${card.size}-${card.rank}`;
      grouped.set(key, (grouped.get(key) || 0) + 1);
    }
    return Array.from(grouped.values()).filter((count) => count >= 4).length;
  }
  calculateMingTangs(melds, totalHuPoints, options) {
    const mingtangs = [];
    const allCards = this.getAllCardsFromMelds(melds);
    const redCardCount = allCards.filter((card) => card.isRed).length;
    if (this.isMingTangEnabled("qia" /* QIA */, options.enabledMingTangTypes) && totalHuPoints > 0 && totalHuPoints % 10 === 0) {
      mingtangs.push(this.buildMingTang("qia" /* QIA */));
    }
    if (this.isMingTangEnabled("luan" /* LUAN */, options.enabledMingTangTypes) && totalHuPoints === 0) {
      mingtangs.push(this.buildMingTang("luan" /* LUAN */));
    }
    if (this.isMingTangEnabled("hong" /* HONG */, options.enabledMingTangTypes) && redCardCount >= 10) {
      mingtangs.push(this.buildMingTang("hong" /* HONG */));
    }
    if (this.isMingTangEnabled("hei" /* HEI */, options.enabledMingTangTypes) && redCardCount === 0) {
      mingtangs.push(this.buildMingTang("hei" /* HEI */));
    }
    if (this.isMingTangEnabled("tian_hu" /* TIAN_HU */, options.enabledMingTangTypes) && options.isHeavenlyWin) {
      mingtangs.push(this.buildMingTang("tian_hu" /* TIAN_HU */));
    }
    if (this.isMingTangEnabled("shui_shang_piao" /* SHUI_SHANG_PIAO */, options.enabledMingTangTypes) && options.isFirstDrawWin) {
      mingtangs.push(this.buildMingTang("shui_shang_piao" /* SHUI_SHANG_PIAO */));
    }
    if (this.isMingTangEnabled("hai_di_lao" /* HAI_DI_LAO */, options.enabledMingTangTypes) && options.isLastDrawWin) {
      mingtangs.push(this.buildMingTang("hai_di_lao" /* HAI_DI_LAO */));
    }
    if (this.isMingTangEnabled("kun" /* KUN */, options.enabledMingTangTypes)) {
      const nonPairMelds = melds.filter((meld) => meld.type !== "pair" /* PAIR */);
      if (nonPairMelds.length > 0 && nonPairMelds.every((meld) => meld.huPoints > 0)) {
        mingtangs.push(this.buildMingTang("kun" /* KUN */));
      }
    }
    if (this.isMingTangEnabled("gui" /* GUI */, options.enabledMingTangTypes)) {
      const guiCount = this.countGui(allCards);
      if (guiCount > 0) {
        const guiMingTang = this.buildMingTang("gui" /* GUI */);
        mingtangs.push({
          ...guiMingTang,
          fan: guiCount,
          description: `\u5171\u6709${guiCount}\u4E2A\u5F52`
        });
      }
    }
    if (this.isMingTangEnabled("zi_mo" /* ZI_MO */, options.enabledMingTangTypes) && options.winType === "self_draw" /* SELF_DRAW */) {
      mingtangs.push(this.buildMingTang("zi_mo" /* ZI_MO */));
    }
    if (this.isMingTangEnabled("bao" /* BAO */, options.enabledMingTangTypes) && options.isBaoWin) {
      mingtangs.push(this.buildMingTang("bao" /* BAO */));
    }
    if (this.isMingTangEnabled("sha_bao" /* SHA_BAO */, options.enabledMingTangTypes) && options.isShaBao) {
      mingtangs.push(this.buildMingTang("sha_bao" /* SHA_BAO */));
    }
    return mingtangs;
  }
  /**
   * 计算牌型的胡息
   */
  calculateMeldHuPoints(meld) {
    if (meld.type === "sequence" /* SEQUENCE */) {
      const ranks = meld.cards.map((c) => c.rank);
      const specialHu = getSpecialSequenceHu(ranks, meld.cards[0].size);
      if (specialHu !== null) {
        return specialHu;
      }
    }
    const cardInfo = {
      size: meld.cards[0].size,
      color: meld.cards[0].color
    };
    return getHuPoints(meld.type, cardInfo);
  }
  /**
   * 计算总分
   */
  calculateTotalScore(melds, options = {}) {
    let totalHuPoints = 0;
    const meldScores = [];
    for (const meld of melds) {
      const score = this.calculateMeldHuPoints(meld);
      meld.huPoints = score;
      totalHuPoints += score;
      meldScores.push({
        meld,
        score
      });
    }
    const mingtangs = this.calculateMingTangs(melds, totalHuPoints, options);
    const baseScore = getBaseScoreByHu(totalHuPoints);
    const totalFans = BASE_FAN + mingtangs.reduce((sum, item) => sum + item.fan, 0);
    const bonusPoints = totalFans - BASE_FAN;
    const roundScore = baseScore * totalFans;
    const finalScore = roundScore;
    return {
      totalHuPoints,
      baseScore,
      meldScores,
      bonusPoints,
      mingtangs,
      totalFans,
      roundScore,
      finalScore
    };
  }
  /**
   * 检查是否胡牌
   */
  checkCanWin(melds, totalHuPoints, isZeroHu) {
    const pairCount = melds.filter((m) => m.type === "pair" /* PAIR */).length;
    const groupCount = melds.length - pairCount;
    return checkWinCondition(totalHuPoints, groupCount, pairCount, isZeroHu);
  }
  /**
   * 计算听牌（可以胡哪些牌）
   */
  calculateTingCards(handCards, knownCards) {
    const tingCards = [];
    const meldDetector = new MeldDetector();
    const fullDeck = CardFactory.createDeck();
    const possibleCards = fullDeck.filter((card) => !knownCards.has(card.id));
    const pairs = meldDetector.detectPairs(handCards);
    const triples = meldDetector.detectTriples(handCards);
    for (const card of possibleCards) {
      const newHandCards = [...handCards, card];
      const allMelds = [];
      allMelds.push(...pairs.melds);
      allMelds.push(...triples.melds);
      const newPairs = meldDetector.detectPairs(newHandCards);
      allMelds.push(...newPairs.melds);
      const newTriples = meldDetector.detectTriples(newHandCards);
      allMelds.push(...newTriples.melds);
      const sequences = meldDetector.detectSequences(newHandCards);
      allMelds.push(...sequences.melds);
      const special2710 = meldDetector.detectSpecial2710(newHandCards);
      allMelds.push(...special2710.melds);
      const { totalHuPoints } = this.calculateTotalScore(allMelds);
      const isZeroHu = totalHuPoints === 0;
      if (this.checkCanWin(allMelds, totalHuPoints, isZeroHu)) {
        tingCards.push(card);
      }
    }
    return tingCards;
  }
  /**
   * 计算牌型价值（用于AI评估）
   */
  calculateMeldValue(meld) {
    let value = meld.huPoints;
    const redCards = meld.cards.filter((c) => c.isRed);
    value += redCards.length * 0.5;
    const bigCards = meld.cards.filter((c) => c.size === "big" /* BIG */);
    value += bigCards.length * 0.3;
    if (meld.type === "special_2710" /* SPECIAL_2710 */) {
      value += 2;
    }
    return value;
  }
  /**
   * 计算手牌总价值
   */
  calculateHandValue(melds) {
    return melds.reduce((sum, meld) => sum + this.calculateMeldValue(meld), 0);
  }
  /**
   * 比较两个手牌的强弱
   */
  compareHands(melds1, melds2) {
    const value1 = this.calculateHandValue(melds1);
    const value2 = this.calculateHandValue(melds2);
    return value1 - value2;
  }
};

// src/game-engine/passed-play.ts
function sameCardIdentity(left, right) {
  return left.rank === right.rank && left.size === right.size;
}
function hasPassedCard(player, card) {
  return player.passedPlays.some((passedPlay) => (passedPlay.actionType === "discard" || passedPlay.actionType === "chi") && sameCardIdentity(passedPlay.card, card));
}
function canClaimActiveCard(state, playerIndex, card, claimType) {
  const player = state.players[playerIndex];
  if (!player) {
    return { allowed: false, reason: "\u73A9\u5BB6\u4E0D\u5B58\u5728" };
  }
  if ((claimType === "chi" || claimType === "hu") && hasPassedCard(player, card)) {
    return { allowed: false, reason: "\u5DF2\u8FC7\u5F20\uFF0C\u4E0D\u80FD\u518D\u5403\u6216\u80E1\u6B64\u724C" };
  }
  return { allowed: true };
}

// src/game-engine/rules-validator.ts
var RulesValidator = class {
  constructor() {
    this.meldDetector = new MeldDetector();
    this.scoreCalculator = new ScoreCalculator();
  }
  /**
   * 验证牌型是否有效
   */
  isValidMeld(cards, type) {
    if (cards.length === 0) return false;
    switch (type) {
      case "pair" /* PAIR */:
        return cards.length === 2 && CardComparator.isSame(cards[0], cards[1]);
      case "peng" /* PENG */:
      case "triple" /* TRIPLE */:
        return cards.length === 3 && cards.every((c) => CardComparator.isSame(cards[0], c));
      case "quadruple" /* QUADRUPLE */:
      case "draw_quadruple" /* DRAW_QUADRUPLE */:
        return cards.length === 4 && cards.every((c) => CardComparator.isSame(cards[0], c));
      case "sequence" /* SEQUENCE */:
        if (cards.length !== 3) return false;
        if (!cards.every((c) => c.size === cards[0].size)) return false;
        {
          const seqValues = cards.map((c) => c.value).sort((a, b) => a - b);
          return seqValues[1] === seqValues[0] + 1 && seqValues[2] === seqValues[1] + 1;
        }
      case "special_2710" /* SPECIAL_2710 */:
        if (cards.length !== 3) return false;
        if (!cards.every((c) => c.size === cards[0].size)) return false;
        {
          const specialValues = cards.map((c) => c.value).sort((a, b) => a - b);
          return specialValues[0] === 2 && specialValues[1] === 7 && specialValues[2] === 10;
        }
      case "mixed_size" /* MIXED_SIZE */:
        if (cards.length !== 3) return false;
        if (!cards.every((c) => c.value === cards[0].value)) return false;
        const sizes = new Set(cards.map((c) => c.size));
        return sizes.size === 2;
      default:
        return false;
    }
  }
  /**
   * 检查是否可以吃牌
   */
  canChi(handCards, targetCard) {
    return this.getValidChiOptions(handCards, targetCard).length > 0;
  }
  getValidChiOptions(handCards, targetCard) {
    const chiOptions = [];
    const seen = /* @__PURE__ */ new Set();
    const lockedCardIds = this.getLockedMeldCardIds(handCards);
    const unlockedCards = handCards.filter((c) => !lockedCardIds.has(c.id));
    for (let i = 0; i < unlockedCards.length; i++) {
      for (let j = i + 1; j < unlockedCards.length; j++) {
        const selected = [unlockedCards[i], unlockedCards[j]];
        const allCards = [...selected, targetCard];
        const meldType = this.detectChiMeldType(allCards);
        if (!meldType || !this.isValidMeld(allCards, meldType)) continue;
        const compareResults = this.findCompareCardResults(handCards, allCards);
        for (const compareResult of compareResults) {
          const signature = this.buildChiOptionDisplaySignature(selected, targetCard, compareResult.additionalMelds);
          if (seen.has(signature)) {
            continue;
          }
          seen.add(signature);
          chiOptions.push({
            id: this.buildChiOptionId(selected, compareResult.additionalMelds),
            mainMeldCards: allCards,
            selectedCards: selected,
            additionalMelds: compareResult.additionalMelds,
            remainingCards: compareResult.remainingCards,
            description: this.buildChiOptionDescription(selected, targetCard, compareResult.additionalMelds)
          });
        }
      }
    }
    return chiOptions;
  }
  getValidChiSelections(handCards, targetCard) {
    const seen = /* @__PURE__ */ new Set();
    return this.getValidChiOptions(handCards, targetCard).map((option) => option.selectedCards).filter((cards) => {
      const signature = cards.map((card) => card.id).sort().join(",");
      if (seen.has(signature)) {
        return false;
      }
      seen.add(signature);
      return true;
    });
  }
  checkCompareCards(handCards, chiCards) {
    const results = this.findCompareCardResults(handCards, chiCards);
    if (results.length > 0) {
      return results[0];
    }
    const failureReason = this.getCompareCardFailureReason(handCards, chiCards);
    return {
      canChi: false,
      remainingCards: handCards,
      additionalMelds: [],
      reason: failureReason
    };
  }
  canFormSequenceWithCard(handCards, targetCard, lockedCardIds) {
    const options = this.getSequenceOptionsWithCard(handCards, targetCard, lockedCardIds);
    if (options.length === 0) {
      return { canForm: false, usedCards: [] };
    }
    return {
      canForm: true,
      meld: options[0].meld,
      usedCards: options[0].usedCards
    };
  }
  getSequenceOptionsWithCard(handCards, targetCard, lockedCardIds) {
    if (lockedCardIds?.has(targetCard.id)) {
      return [];
    }
    const pushOption = (options2, seen2, type, cards) => {
      const signature = cards.map((card) => card.id).sort().join(",");
      if (seen2.has(signature)) {
        return;
      }
      seen2.add(signature);
      const meld = {
        type,
        cards,
        isConcealed: false,
        position: "table",
        huPoints: 0
      };
      meld.huPoints = this.scoreCalculator.calculateMeldHuPoints(meld);
      options2.push({ meld, usedCards: cards });
    };
    const options = [];
    const seen = /* @__PURE__ */ new Set();
    const sameTypeCards = handCards.filter((c) => c.size === targetCard.size);
    const targetValue = targetCard.value;
    if (targetValue <= 8) {
      const nextCards = sameTypeCards.filter((c) => c.value === targetValue + 1 && !lockedCardIds?.has(c.id));
      const nextNextCards = sameTypeCards.filter((c) => c.value === targetValue + 2 && !lockedCardIds?.has(c.id));
      for (const card2 of nextCards) {
        for (const card3 of nextNextCards) {
          pushOption(options, seen, "sequence" /* SEQUENCE */, [targetCard, card2, card3]);
        }
      }
    }
    if (targetValue >= 2 && targetValue <= 9) {
      const prevCards = sameTypeCards.filter((c) => c.value === targetValue - 1 && !lockedCardIds?.has(c.id));
      const nextCards = sameTypeCards.filter((c) => c.value === targetValue + 1 && !lockedCardIds?.has(c.id));
      for (const card1 of prevCards) {
        for (const card3 of nextCards) {
          pushOption(options, seen, "sequence" /* SEQUENCE */, [card1, targetCard, card3]);
        }
      }
    }
    if (targetValue >= 3) {
      const prevPrevCards = sameTypeCards.filter((c) => c.value === targetValue - 2 && !lockedCardIds?.has(c.id));
      const prevCards = sameTypeCards.filter((c) => c.value === targetValue - 1 && !lockedCardIds?.has(c.id));
      for (const card1 of prevPrevCards) {
        for (const card2 of prevCards) {
          pushOption(options, seen, "sequence" /* SEQUENCE */, [card1, card2, targetCard]);
        }
      }
    }
    if ([2, 7, 10].includes(targetValue)) {
      const twos = targetValue === 2 ? [targetCard] : sameTypeCards.filter((c) => c.value === 2 && !lockedCardIds?.has(c.id));
      const sevens = targetValue === 7 ? [targetCard] : sameTypeCards.filter((c) => c.value === 7 && !lockedCardIds?.has(c.id));
      const tens = targetValue === 10 ? [targetCard] : sameTypeCards.filter((c) => c.value === 10 && !lockedCardIds?.has(c.id));
      for (const card2 of twos) {
        for (const card7 of sevens) {
          for (const card10 of tens) {
            pushOption(options, seen, "special_2710" /* SPECIAL_2710 */, [card2, card7, card10]);
          }
        }
      }
    }
    const sameValueCards = handCards.filter(
      (c) => c.value === targetCard.value && c.id !== targetCard.id && !lockedCardIds?.has(c.id)
    );
    const sameSizeCards = sameValueCards.filter((c) => c.size === targetCard.size);
    const diffSizeCards = sameValueCards.filter((c) => c.size !== targetCard.size);
    for (const sameSizeCard of sameSizeCards) {
      for (const diffSizeCard of diffSizeCards) {
        pushOption(options, seen, "mixed_size" /* MIXED_SIZE */, [targetCard, sameSizeCard, diffSizeCard]);
      }
    }
    for (let i = 0; i < diffSizeCards.length; i++) {
      for (let j = i + 1; j < diffSizeCards.length; j++) {
        pushOption(options, seen, "mixed_size" /* MIXED_SIZE */, [targetCard, diffSizeCards[i], diffSizeCards[j]]);
      }
    }
    return options;
  }
  findCompareCardResults(handCards, chiCards) {
    const usedCardIds = /* @__PURE__ */ new Set();
    chiCards.forEach((c) => usedCardIds.add(c.id));
    const targetCard = chiCards[chiCards.length - 1];
    const lockedCardIds = this.getLockedMeldCardIds(handCards);
    const compareCards = handCards.filter(
      (card) => !usedCardIds.has(card.id) && card.rank === targetCard.rank && card.size === targetCard.size
    );
    if (compareCards.some((card) => lockedCardIds.has(card.id))) {
      return [];
    }
    const availableCards = handCards.filter(
      (card) => !usedCardIds.has(card.id) && !compareCards.some((compareCard) => compareCard.id === card.id)
    );
    const search = (pendingCompareCards, remainingCards, additionalMelds, consumedIds) => {
      if (pendingCompareCards.length === 0) {
        const finalUsedIds = /* @__PURE__ */ new Set([...usedCardIds, ...consumedIds]);
        return [{
          canChi: true,
          remainingCards: handCards.filter((card) => !finalUsedIds.has(card.id)),
          additionalMelds
        }];
      }
      const [currentCompareCard, ...restCompareCards] = pendingCompareCards;
      const sequenceOptions = this.getSequenceOptionsWithCard(remainingCards, currentCompareCard, lockedCardIds);
      if (sequenceOptions.length === 0) {
        return [];
      }
      const results = [];
      for (const option of sequenceOptions) {
        const nextRemainingCards = remainingCards.filter(
          (card) => !option.usedCards.some((usedCard) => usedCard.id === card.id)
        );
        const nextConsumedIds = /* @__PURE__ */ new Set([
          ...consumedIds,
          currentCompareCard.id,
          ...option.usedCards.map((card) => card.id)
        ]);
        results.push(...search(restCompareCards, nextRemainingCards, [...additionalMelds, option.meld], nextConsumedIds));
      }
      return results;
    };
    return search(compareCards, availableCards, [], /* @__PURE__ */ new Set());
  }
  getCompareCardFailureReason(handCards, chiCards) {
    const usedCardIds = new Set(chiCards.map((card) => card.id));
    const targetCard = chiCards[chiCards.length - 1];
    const lockedCardIds = this.getLockedMeldCardIds(handCards);
    const compareCards = handCards.filter(
      (card) => !usedCardIds.has(card.id) && card.rank === targetCard.rank && card.size === targetCard.size
    );
    for (const compareCard of compareCards) {
      if (lockedCardIds.has(compareCard.id)) {
        return `\u6BD4\u724C${compareCard.rank}\u4F4D\u4E8E\u574E/\u5785\u4E2D\uFF0C\u4E0D\u80FD\u62C6\u574E\u6BD4\u724C`;
      }
    }
    for (const compareCard of compareCards) {
      const remainingCards = handCards.filter(
        (card) => !usedCardIds.has(card.id) && !compareCards.some((compare) => compare.id === card.id)
      );
      if (this.getSequenceOptionsWithCard(remainingCards, compareCard, lockedCardIds).length === 0) {
        return `\u6BD4\u724C${compareCard.rank}\u65E0\u6CD5\u7EC4\u6210\u987A\u5B50\uFF0C\u4E0D\u80FD\u5403\u724C`;
      }
    }
    return "\u5F53\u524D\u5403\u724C\u65B9\u6848\u4E0D\u5B58\u5728\u5408\u6CD5\u6BD4\u724C\u7EC4\u5408";
  }
  buildChiOptionDescription(selectedCards, targetCard, additionalMelds) {
    const formatCards = (cards) => cards.map((card) => `${card.rank}${card.size === "small" /* SMALL */ ? "\u5C0F" : "\u5927"}`).join(" ");
    const mainText = `\u5403\u724C\uFF1A${formatCards([targetCard, ...selectedCards])}`;
    if (additionalMelds.length === 0) {
      return mainText;
    }
    const compareText = additionalMelds.map((meld, index) => `\u6BD4\u724C${index + 1}\uFF1A${formatCards(meld.cards)}`).join("\uFF1B");
    return `${mainText}\uFF1B${compareText}`;
  }
  buildChiOptionId(selectedCards, additionalMelds) {
    const selectedPart = selectedCards.map((card) => card.id).sort().join("_");
    const comparePart = additionalMelds.map((meld) => meld.cards.map((card) => card.id).sort().join("_")).sort().join("__");
    return `chi_${selectedPart}__${comparePart || "base"}`;
  }
  buildChiOptionDisplaySignature(selectedCards, targetCard, additionalMelds) {
    const toCardKey = (card) => `${card.value}-${card.size}`;
    return [[targetCard, ...selectedCards], ...additionalMelds.map((meld) => meld.cards)].map((cards) => cards.map(toCardKey).sort().join("_")).sort().join("__");
  }
  getLockedMeldCardIds(handCards) {
    const locked = /* @__PURE__ */ new Set();
    const triples = this.meldDetector.detectTriples(handCards).melds;
    const quads = this.meldDetector.detectQuadruples(handCards).melds;
    for (const meld of [...triples, ...quads]) {
      for (const card of meld.cards) {
        locked.add(card.id);
      }
    }
    return locked;
  }
  detectChiMeldType(cards) {
    if (cards.length !== 3) return null;
    const sameValue = cards.every((c) => c.value === cards[0].value);
    const mixedSize = new Set(cards.map((c) => c.size)).size === 2;
    if (sameValue && mixedSize) {
      return "mixed_size" /* MIXED_SIZE */;
    }
    const values = cards.map((c) => c.value).sort((a, b) => a - b);
    if (values[0] === 2 && values[1] === 7 && values[2] === 10) {
      return "special_2710" /* SPECIAL_2710 */;
    }
    const sameSize = cards.every((c) => c.size === cards[0].size);
    if (sameSize && values[1] === values[0] + 1 && values[2] === values[1] + 1) {
      return "sequence" /* SEQUENCE */;
    }
    return null;
  }
  canPeng(handCards, targetCard) {
    const sameCards = handCards.filter((c) => CardComparator.isSame(c, targetCard));
    return sameCards.length >= 2;
  }
  /**
   * 检查是否可以招牌
   */
  canZhao(handCards, targetCard) {
    const sameCards = handCards.filter((c) => CardComparator.isSame(c, targetCard));
    return sameCards.length >= 3;
  }
  getBaoTingCards(handCards, melds = []) {
    const fullDeck = CardFactory.createDeck();
    const existingCounts = /* @__PURE__ */ new Map();
    for (const card of [...handCards, ...melds.flatMap((meld) => meld.cards || [])]) {
      const key = `${card.size}-${card.value}`;
      existingCounts.set(key, (existingCounts.get(key) || 0) + 1);
    }
    const candidates = /* @__PURE__ */ new Map();
    for (const card of fullDeck) {
      const key = `${card.size}-${card.value}`;
      if ((existingCounts.get(key) || 0) >= 4 || candidates.has(key)) {
        continue;
      }
      candidates.set(key, card);
    }
    return Array.from(candidates.values()).filter((card) => this.canHu(handCards, melds, card, "draw") || this.getHuChiOptions(handCards, melds, card).length > 0);
  }
  getBaoDiscardCandidates(handCards, melds = []) {
    return handCards.map((discardCard) => {
      const remainingCards = handCards.filter((card) => card.id !== discardCard.id);
      return {
        discardCard,
        tingCards: this.getBaoTingCards(remainingCards, melds)
      };
    }).filter((candidate) => candidate.tingCards.length > 0);
  }
  /**
   * 检查是否可以胡牌
   */
  canHu(handCards, melds, activeCard, activeCardSource) {
    const effectiveHandCards = activeCard ? [...handCards, activeCard] : handCards;
    const winningHandMelds = this.findWinningHandMelds(effectiveHandCards, melds, activeCard, activeCardSource);
    if (!winningHandMelds) return false;
    const allMelds = [...melds, ...winningHandMelds];
    if (!this.isValidHuStructure(allMelds)) return false;
    const { totalHuPoints } = this.scoreCalculator.calculateTotalScore(allMelds);
    const isZeroHu = totalHuPoints === 0;
    return this.scoreCalculator.checkCanWin(allMelds, totalHuPoints, isZeroHu);
  }
  getHuChiOptions(handCards, melds, activeCard) {
    if (!activeCard) {
      return [];
    }
    const chiOptions = this.getValidChiOptions(handCards, activeCard);
    return chiOptions.filter((option) => {
      const mainMeldType = this.detectChiMeldType(option.mainMeldCards);
      if (!mainMeldType) {
        return false;
      }
      const mainMeld = {
        type: mainMeldType,
        cards: option.mainMeldCards,
        isConcealed: false,
        position: "table",
        huPoints: 0
      };
      mainMeld.huPoints = this.scoreCalculator.calculateMeldHuPoints(mainMeld);
      const landedMelds = [...melds, mainMeld, ...option.additionalMelds];
      const winningHandMelds = this.findWinningHandMelds(option.remainingCards, landedMelds);
      if (!winningHandMelds) {
        return false;
      }
      const allMelds = [...landedMelds, ...winningHandMelds];
      if (!this.isValidHuStructure(allMelds)) {
        return false;
      }
      const { totalHuPoints } = this.scoreCalculator.calculateTotalScore(allMelds);
      const isZeroHu = totalHuPoints === 0;
      return this.scoreCalculator.checkCanWin(allMelds, totalHuPoints, isZeroHu);
    });
  }
  /**
   * 新胡牌结构规则（V3修订）：
   * 1) 总是7个牌组单元
   * 2) 4张组仅统计 ZHAO/LONG（DRAW_QUADRUPLE/QUADRUPLE）
   * 3) 若4张组数=0，则将牌数必须=0
   * 4) 若4张组数>=1，则将牌数必须=1
   * 5) 3张组数量满足 g = 7 - h - p
   */
  isValidHuStructure(allMelds) {
    const heavyQuadCount = allMelds.filter(
      (m) => m.type === "quadruple" /* QUADRUPLE */ || m.type === "draw_quadruple" /* DRAW_QUADRUPLE */
    ).length;
    const pairCount = allMelds.filter((m) => m.type === "pair" /* PAIR */).length;
    const expectedPairCount = heavyQuadCount >= 1 ? 1 : 0;
    if (pairCount !== expectedPairCount) {
      return false;
    }
    const tripleGroupCount = allMelds.filter(
      (m) => m.type !== "pair" /* PAIR */ && m.type !== "quadruple" /* QUADRUPLE */ && m.type !== "draw_quadruple" /* DRAW_QUADRUPLE */
    ).length;
    const expectedTripleGroupCount = 7 - heavyQuadCount - expectedPairCount;
    if (expectedTripleGroupCount < 0) {
      return false;
    }
    if (tripleGroupCount !== expectedTripleGroupCount) {
      return false;
    }
    if (allMelds.length !== 7) {
      return false;
    }
    for (const meld of allMelds) {
      if (meld.type === "pair" /* PAIR */ && meld.cards.length !== 2) return false;
      if ((meld.type === "quadruple" /* QUADRUPLE */ || meld.type === "draw_quadruple" /* DRAW_QUADRUPLE */) && meld.cards.length !== 4) return false;
      if (meld.type !== "pair" /* PAIR */ && meld.type !== "quadruple" /* QUADRUPLE */ && meld.type !== "draw_quadruple" /* DRAW_QUADRUPLE */ && meld.cards.length !== 3) {
        return false;
      }
    }
    return true;
  }
  findWinningHandMelds(handCards, tableMelds, activeCard, _activeCardSource) {
    const tablePairCount = tableMelds.filter((m) => m.type === "pair" /* PAIR */).length;
    const tableGroupCount = tableMelds.length - tablePairCount;
    if (tablePairCount > 1 || tableGroupCount > 7) return null;
    const baseHandCards = activeCard ? handCards.filter((card) => card.id !== activeCard.id) : handCards;
    const lockedQuadruples = this.meldDetector.detectQuadruples(baseHandCards).melds;
    const lockedTriples = this.meldDetector.detectTriples(
      baseHandCards.filter(
        (card) => !lockedQuadruples.some((meld) => meld.cards.some((meldCard) => meldCard.id === card.id))
      )
    ).melds;
    const lockedCardIds = /* @__PURE__ */ new Set();
    const lockedCardGroupSizes = /* @__PURE__ */ new Map();
    for (const meld of lockedQuadruples) {
      for (const card of meld.cards) {
        lockedCardIds.add(card.id);
        lockedCardGroupSizes.set(card.id, 4);
      }
    }
    for (const meld of lockedTriples) {
      for (const card of meld.cards) {
        if (lockedCardIds.has(card.id)) {
          continue;
        }
        lockedCardIds.add(card.id);
        lockedCardGroupSizes.set(card.id, 3);
      }
    }
    const sorted = [...handCards].sort((a, b) => {
      if (a.value !== b.value) return a.value - b.value;
      if (a.size !== b.size) return a.size === "small" /* SMALL */ ? -1 : 1;
      return a.id.localeCompare(b.id);
    });
    const removeCards = (source, toRemove) => {
      const ids = new Set(toRemove.map((c) => c.id));
      return source.filter((c) => !ids.has(c.id));
    };
    const toMeld = (type, cards) => ({
      type,
      cards,
      isConcealed: true,
      position: "hand",
      huPoints: 0
    });
    const resolveTripleLikeMeldType = (cards) => {
      const includesActiveCard = !!activeCard && cards.some((card) => card.id === activeCard.id);
      if (includesActiveCard) {
        return "peng" /* PENG */;
      }
      return "triple" /* TRIPLE */;
    };
    const dfs = (remaining, acc, pairCountInHand) => {
      const currentPairCount = tablePairCount + pairCountInHand;
      const currentGroupCount = tableGroupCount + acc.filter((m) => m.type !== "pair" /* PAIR */).length;
      if (currentPairCount > 1 || currentGroupCount > 7) {
        return null;
      }
      if (remaining.length === 0) {
        const all = [...tableMelds, ...acc];
        if (!this.isValidHuStructure(all)) {
          return null;
        }
        const { totalHuPoints } = this.scoreCalculator.calculateTotalScore(all);
        const isZeroHu = totalHuPoints === 0;
        if (this.scoreCalculator.checkCanWin(all, totalHuPoints, isZeroHu)) {
          return acc;
        }
        return null;
      }
      const pivot = remaining[0];
      const same = remaining.filter((c) => CardComparator.isSame(c, pivot));
      const lockedGroupSize = lockedCardGroupSizes.get(pivot.id);
      const isLockedPivot = lockedGroupSize === 3 || lockedGroupSize === 4;
      const lockedSame = same.filter((card) => lockedCardIds.has(card.id));
      const unlockedSame = same.filter((card) => !lockedCardIds.has(card.id));
      if (!isLockedPivot && unlockedSame.length >= 2 && currentPairCount === 0) {
        const used = [unlockedSame[0], unlockedSame[1]];
        const found = dfs(removeCards(remaining, used), [...acc, toMeld("pair" /* PAIR */, used)], pairCountInHand + 1);
        if (found) return found;
      }
      const canUseLockedTriple = lockedGroupSize === 3 && lockedSame.length >= 3;
      if (canUseLockedTriple || !isLockedPivot && unlockedSame.length >= 3) {
        const used = canUseLockedTriple ? lockedSame.slice(0, 3) : unlockedSame.slice(0, 3);
        const found = dfs(
          removeCards(remaining, used),
          [...acc, toMeld(resolveTripleLikeMeldType(used), used)],
          pairCountInHand
        );
        if (found) return found;
      }
      const canUseLockedQuadruple = lockedGroupSize === 4 && lockedSame.length >= 4;
      if (canUseLockedQuadruple || !isLockedPivot && unlockedSame.length >= 4) {
        const used = canUseLockedQuadruple ? lockedSame.slice(0, 4) : unlockedSame.slice(0, 4);
        const found = dfs(removeCards(remaining, used), [...acc, toMeld("quadruple" /* QUADRUPLE */, used)], pairCountInHand);
        if (found) return found;
      }
      if (!isLockedPivot) {
        const seq2 = remaining.find((c) => c.size === pivot.size && c.value === pivot.value + 1 && c.id !== pivot.id && !lockedCardIds.has(c.id));
        const seq3 = remaining.find((c) => c.size === pivot.size && c.value === pivot.value + 2 && c.id !== pivot.id && !lockedCardIds.has(c.id));
        if (seq2 && seq3) {
          const used = [pivot, seq2, seq3];
          const found = dfs(removeCards(remaining, used), [...acc, toMeld("sequence" /* SEQUENCE */, used)], pairCountInHand);
          if (found) return found;
        }
        if ([2, 7, 10].includes(pivot.value)) {
          const need = [2, 7, 10].filter((v) => v !== pivot.value);
          const c1 = remaining.find((c) => c.size === pivot.size && c.value === need[0] && c.id !== pivot.id && !lockedCardIds.has(c.id));
          const c2 = remaining.find((c) => c.size === pivot.size && c.value === need[1] && c.id !== pivot.id && !lockedCardIds.has(c.id));
          if (c1 && c2) {
            const used = [pivot, c1, c2];
            const found = dfs(removeCards(remaining, used), [...acc, toMeld("special_2710" /* SPECIAL_2710 */, used)], pairCountInHand);
            if (found) return found;
          }
        }
        const sameValue = remaining.filter((c) => c.value === pivot.value && !lockedCardIds.has(c.id));
        const sameSize = sameValue.filter((c) => c.size === pivot.size);
        const diffSize = sameValue.filter((c) => c.size !== pivot.size);
        if (sameSize.length >= 2 && diffSize.length >= 1) {
          const used = [sameSize[0], sameSize[1], diffSize[0]];
          const found = dfs(removeCards(remaining, used), [...acc, toMeld("mixed_size" /* MIXED_SIZE */, used)], pairCountInHand);
          if (found) return found;
        }
        if (diffSize.length >= 2) {
          const used = [pivot, diffSize[0], diffSize[1]];
          const found = dfs(removeCards(remaining, used), [...acc, toMeld("mixed_size" /* MIXED_SIZE */, used)], pairCountInHand);
          if (found) return found;
        }
      }
      return null;
    };
    return dfs(sorted, [], 0);
  }
  /**
   * 获取强制操作
   * R7.4.1: 有招必招，除非可胡（胡牌优先）
   * R7.4.2: 有碰必碰，除非可胡或可招（优先级：胡>招>碰）
   */
  getMandatoryActions(state) {
    const actions = [];
    const currentPlayer = state.players[state.currentPlayerIndex];
    const currentCard = state.discardPile.lastDiscard;
    if (state.phase !== "response_collecting" /* RESPONSE_COLLECTING */) return actions;
    if (!currentCard) return actions;
    const isOwnDiscard = state.pendingCardSource === "discard" && state.discardPile.lastDiscardPlayerIndex === state.currentPlayerIndex;
    if (isOwnDiscard) {
      return actions;
    }
    const canHuNow = canClaimActiveCard(state, state.currentPlayerIndex, currentCard, "hu").allowed && this.canHu(
      currentPlayer.cards,
      currentPlayer.melds,
      currentCard,
      state.pendingCardSource
    );
    if (canHuNow) {
      return actions;
    }
    if (state.ruleProfile?.mandatoryZhao !== false && this.canZhao(currentPlayer.cards, currentCard)) {
      actions.push({
        type: "zhao",
        cards: [currentCard],
        isMandatory: true,
        description: "\u5FC5\u987B\u62DB\u724C\uFF08R7.4.1\uFF09"
      });
      return actions;
    }
    if (state.ruleProfile?.mandatoryPeng !== false && !currentPlayer.isBao && this.canPeng(currentPlayer.cards, currentCard)) {
      actions.push({
        type: "peng",
        cards: [currentCard],
        isMandatory: true,
        description: "\u5FC5\u987B\u78B0\u724C\uFF08R7.4.2\uFF09"
      });
    }
    return actions;
  }
  /**
   * 检查是否形成八块
   */
  hasEightBlocks(melds) {
    let count = 0;
    for (const meld of melds) {
      if (meld.type === "quadruple" /* QUADRUPLE */ || meld.type === "draw_quadruple" /* DRAW_QUADRUPLE */) {
        count++;
      }
    }
    return count >= 2;
  }
  /**
   * 检查是否可以胜利（供胜率计算器使用）
   */
  checkCanWin(remainingCards, melds, totalHuPoints) {
    const isZeroHu = totalHuPoints === 0;
    return this.scoreCalculator.checkCanWin(melds, totalHuPoints, isZeroHu);
  }
  /**
   * 检查是否为天胡
   */
  checkHeavenlyWin(handCards) {
    const stats = this.meldDetector.calculateStats(handCards);
    return isHeavenlyWin(stats.quadruples, stats.triples);
  }
  /**
   * 验证游戏状态
   */
  validateGameState(state) {
    const errors = [];
    if (state.players.length !== 3) {
      errors.push(`\u65E0\u6548\u7684\u73A9\u5BB6\u6570\u91CF: ${state.players.length}`);
    }
    if (state.currentPlayerIndex < 0 || state.currentPlayerIndex >= state.players.length) {
      errors.push(`\u65E0\u6548\u7684\u5F53\u524D\u73A9\u5BB6\u7D22\u5F15: ${state.currentPlayerIndex}`);
    }
    for (let i = 0; i < state.players.length; i++) {
      const player = state.players[i];
      const expectedCards = state.phase === "bao_selection" /* BAO_SELECTION */ ? 20 : player.isDealer && player.isBao ? 20 : player.isDealer ? 21 : 20;
      const totalCards = player.cards.length + player.melds.reduce((sum, m) => sum + m.cards.length, 0);
      if (player.hasEightBlocks && totalCards === expectedCards + 1) {
        continue;
      }
      if (totalCards !== expectedCards && !state.isGameOver) {
        errors.push(`\u73A9\u5BB6 ${i} \u624B\u724C\u6570\u5F02\u5E38: \u671F\u671B ${expectedCards}, \u5B9E\u9645 ${totalCards}`);
      }
    }
    if (state.phase === "bao_selection" /* BAO_SELECTION */ && !state.dealerPendingCard) {
      errors.push("\u7206\u724C\u9009\u62E9\u9636\u6BB5\u7F3A\u5C11\u5E84\u5BB6\u5F85\u5904\u7406\u7B2C21\u5F20\u724C");
    }
    if (state.phase === "bao_selection" /* BAO_SELECTION */ && state.dealerPendingCard) {
      const playerOwnedIds = new Set(state.players.flatMap((player) => [
        ...player.cards,
        ...player.melds.flatMap((meld) => meld.cards)
      ].map((card) => card.id)));
      const discardOwnedIds = new Set((state.discardPile.cards || []).map((card) => card.id));
      if (playerOwnedIds.has(state.dealerPendingCard.id) || discardOwnedIds.has(state.dealerPendingCard.id)) {
        errors.push("\u5E84\u5BB6\u5F85\u5904\u7406\u724C\u540C\u65F6\u5B58\u5728\u4E8E\u5176\u4ED6\u6240\u6709\u6743\u533A\u57DF");
      }
    }
    return {
      valid: errors.length === 0,
      errors
    };
  }
};

// src/game-engine/turn-order.ts
var THREE_PLAYER_TURN_ORDER = [0, 2, 1];
function getTurnOrder(playerCount) {
  if (playerCount !== THREE_PLAYER_TURN_ORDER.length) {
    throw new Error("Only three-player turn order is supported.");
  }
  return [...THREE_PLAYER_TURN_ORDER];
}
function getSeatPosition(playerIndex, playerCount) {
  const position = getTurnOrder(playerCount).indexOf(playerIndex);
  return position >= 0 ? position : playerIndex;
}
function getNextPlayerIndex(playerIndex, playerCount) {
  const order = getTurnOrder(playerCount);
  if (order.length === 0) return playerIndex;
  const position = getSeatPosition(playerIndex, playerCount);
  return order[(position + 1) % order.length];
}
function getPreviousPlayerIndex(playerIndex, playerCount) {
  const order = getTurnOrder(playerCount);
  if (order.length === 0) return playerIndex;
  const position = getSeatPosition(playerIndex, playerCount);
  return order[(position - 1 + order.length) % order.length];
}
function getTurnDistance(fromPlayerIndex, toPlayerIndex, playerCount) {
  const order = getTurnOrder(playerCount);
  if (order.length === 0) return 0;
  const fromPosition = getSeatPosition(fromPlayerIndex, playerCount);
  const toPosition = getSeatPosition(toPlayerIndex, playerCount);
  return (toPosition - fromPosition + order.length) % order.length;
}
function getResponderOrder(source, sourcePlayerIndex, playerCount) {
  const order = getTurnOrder(playerCount);
  if (order.length === 0) return [];
  const sourcePosition = getSeatPosition(sourcePlayerIndex, playerCount);
  const firstOffset = source === "draw" ? 0 : 1;
  const responderCount = source === "draw" ? order.length : Math.max(0, order.length - 1);
  return Array.from(
    { length: responderCount },
    (_, offset) => order[(sourcePosition + firstOffset + offset) % order.length]
  );
}

// src/game-engine/response-arbitrator.ts
var ResponseArbitrator = class {
  /**
   * 仲裁多个玩家的响应，确定最终执行的响应
   * @param state 游戏状态
   * @param responses 所有玩家的响应
   * @returns 仲裁结果
   */
  arbitrate(state, responses) {
    const activeResponses = responses.filter((r) => r.responseType !== "pass");
    if (activeResponses.length === 0) {
      return {
        winningResponse: null,
        sortedResponses: responses,
        reason: "\u6240\u6709\u73A9\u5BB6\u5747\u9009\u62E9\u8FC7"
      };
    }
    if (activeResponses.length === 1) {
      return {
        winningResponse: activeResponses[0],
        sortedResponses: responses,
        reason: "\u4EC5\u4E00\u4EBA\u54CD\u5E94"
      };
    }
    const sortedResponses = this.sortResponsesByPriorityAndSeat(
      activeResponses,
      state.currentPlayerIndex,
      state.players.length
    );
    const winningResponse = sortedResponses[0];
    const reason = this.generateReason(winningResponse, sortedResponses);
    return {
      winningResponse,
      sortedResponses,
      reason
    };
  }
  /**
   * 按优先级和座次排序响应
   * R7.2.1: 优先级高者先
   * R7.2.2: 同优先级按座次，当前轮玩家起
   */
  sortResponsesByPriorityAndSeat(responses, currentPlayerIndex, playerCount) {
    return [...responses].sort((a, b) => {
      const priorityA = RESPONSE_PRIORITY[a.responseType];
      const priorityB = RESPONSE_PRIORITY[b.responseType];
      if (priorityA !== priorityB) {
        return priorityA - priorityB;
      }
      const seatOrderA = this.getSeatOrder(a.playerIndex, currentPlayerIndex, playerCount);
      const seatOrderB = this.getSeatOrder(b.playerIndex, currentPlayerIndex, playerCount);
      return seatOrderA - seatOrderB;
    });
  }
  /**
   * 获取玩家的座次顺序
   * 当前玩家索引为基准，计算相对顺序
   * 例：当前玩家为0，则顺序为 0→2→1。
   * 
   * @param playerIndex 目标玩家索引
   * @param currentPlayerIndex 当前轮玩家索引
   * @param playerCount 玩家总数
   * @returns 座次顺序（0最优先）
   */
  getSeatOrder(playerIndex, currentPlayerIndex, playerCount) {
    return getTurnDistance(currentPlayerIndex, playerIndex, playerCount);
  }
  /**
   * 生成仲裁原因说明
   */
  generateReason(winner, allResponses) {
    const winnerPriority = RESPONSE_PRIORITY[winner.responseType];
    const samePriorityCount = allResponses.filter(
      (r) => RESPONSE_PRIORITY[r.responseType] === winnerPriority
    ).length;
    if (samePriorityCount === 1) {
      return `\u73A9\u5BB6${winner.playerIndex + 1}\u7684${this.getActionName(winner.responseType)}\u4F18\u5148\u7EA7\u6700\u9AD8`;
    } else {
      return `\u591A\u4EBA${this.getActionName(winner.responseType)}\uFF0C\u73A9\u5BB6${winner.playerIndex + 1}\u5EA7\u6B21\u4F18\u5148`;
    }
  }
  /**
   * 获取操作类型的中文名称
   */
  getActionName(type) {
    const names = {
      hu: "\u80E1\u724C",
      zhao: "\u62DB\u724C",
      peng: "\u78B0\u724C",
      chi: "\u5403\u724C",
      pass: "\u8FC7"
    };
    return names[type] || type;
  }
  /**
   * 检查是否所有玩家都已响应
   * @param state 游戏状态
   * @returns 是否所有玩家都已响应
   */
  allPlayersResponded(state) {
    const respondedPlayers = new Set(
      state.pendingResponses.map((r) => r.playerIndex)
    );
    const discardPlayerIndex = state.discardPile.lastDiscardPlayerIndex;
    const isDiscardSource = state.pendingCardSource === "discard";
    for (let i = 0; i < state.players.length; i++) {
      if (isDiscardSource && i === discardPlayerIndex) continue;
      if (!respondedPlayers.has(i)) {
        return false;
      }
    }
    return true;
  }
  /**
   * 添加玩家响应
   * @param state 游戏状态
   * @param response 玩家响应
   * @returns 更新后的游戏状态
   */
  addResponse(state, response) {
    const existingIndex = state.pendingResponses.findIndex(
      (r) => r.playerIndex === response.playerIndex
    );
    const newResponses = [...state.pendingResponses];
    if (existingIndex >= 0) {
      newResponses[existingIndex] = response;
    } else {
      newResponses.push(response);
    }
    return {
      ...state,
      pendingResponses: newResponses
    };
  }
  /**
   * 获取玩家可用的响应选项
   * @param state 游戏状态
   * @param playerIndex 玩家索引
   * @returns 可用的响应类型列表
   */
  getAvailableResponses(state, playerIndex) {
    const responses = ["pass"];
    const player = state.players[playerIndex];
    const targetCard = state.discardPile.lastDiscard;
    if (!targetCard) return responses;
    if (state.pendingCardSource === "discard" && state.discardPile.lastDiscardPlayerIndex === playerIndex) {
      return responses;
    }
    const sameCardsForZhao = player.cards.filter(
      (c) => c.rank === targetCard.rank && c.size === targetCard.size
    );
    if (sameCardsForZhao.length >= 3) {
      responses.unshift("zhao");
    }
    const sameCardsForPeng = player.cards.filter(
      (c) => c.rank === targetCard.rank && c.size === targetCard.size
    );
    if (!player.isBao && sameCardsForPeng.length >= 2) {
      responses.unshift("peng");
    }
    const previousPlayerIndex = getPreviousPlayerIndex(playerIndex, state.players.length);
    const sourcePlayerIndex = state.discardPile.lastDiscardPlayerIndex;
    const sourcePlayer = typeof sourcePlayerIndex === "number" ? state.players[sourcePlayerIndex] : void 0;
    const sourcePlayerPassedThisCard = !!sourcePlayer && sourcePlayer.passedPlays.some(
      (pp) => (pp.actionType === "chi" || pp.actionType === "discard") && pp.card.rank === targetCard.rank && pp.card.size === targetCard.size
    );
    const canChiBySource = state.pendingCardSource === "discard" && sourcePlayerIndex === previousPlayerIndex || state.pendingCardSource === "draw" && (sourcePlayerIndex === playerIndex || sourcePlayerPassedThisCard && sourcePlayerIndex === previousPlayerIndex);
    if (!player.isBao && canChiBySource) {
      const hasPassedThisCard = player.passedPlays.some(
        (pp) => (pp.actionType === "chi" || pp.actionType === "discard") && pp.card.rank === targetCard.rank && pp.card.size === targetCard.size
      );
      if (!hasPassedThisCard) {
        responses.unshift("chi");
      }
    }
    return responses;
  }
};
var responseArbitrator = new ResponseArbitrator();

// src/game-engine/turn-manager.ts
var TurnManager = class {
  constructor() {
    this.rulesValidator = new RulesValidator();
    this.arbitrator = responseArbitrator;
    this.meldDetector = new MeldDetector();
  }
  /**
   * 开始回合
   */
  startTurn(state) {
    const newState = { ...state };
    newState.phase = "drawing" /* DRAWING */;
    newState.skipDiscardAfterZhao = false;
    newState.availableActions = this.getAvailableActions(newState);
    return newState;
  }
  /**
   * 开始响应收集阶段
   * 当玩家出牌后，进入此阶段等待其他玩家响应
   * R7.2.1/2/3: 收集所有响应后进行仲裁
   */
  startResponseCollection(state) {
    return {
      ...state,
      phase: "response_collecting" /* RESPONSE_COLLECTING */,
      pendingResponses: []
    };
  }
  /**
   * 添加玩家响应
   * @param state 游戏状态
   * @param playerIndex 响应玩家索引
   * @param responseType 响应类型
   * @param cards 相关牌（可选）
   * @returns 更新后的游戏状态
   */
  addPlayerResponse(state, playerIndex, responseType, cards) {
    const response = {
      playerIndex,
      responseType,
      cards: cards || [],
      timestamp: Date.now()
    };
    return this.arbitrator.addResponse(state, response);
  }
  /**
   * 检查是否可以执行仲裁
   * 当所有需要响应的玩家都已响应时返回true
   */
  canResolveResponses(state) {
    return this.arbitrator.allPlayersResponded(state);
  }
  /**
   * 执行响应仲裁
   * R7.2.1: 优先级高者先
   * R7.2.2: 同优先级按座次
   * R7.2.3: 唯一胡牌
   * @returns 仲裁结果
   */
  resolveResponses(state) {
    return this.arbitrator.arbitrate(state, state.pendingResponses);
  }
  /**
   * 获取玩家可用的响应选项
   */
  getAvailableResponsesForPlayer(state, playerIndex) {
    return this.arbitrator.getAvailableResponses(state, playerIndex);
  }
  /**
   * 结束回合并交给下一个玩家
   */
  endTurn(state) {
    const nextPlayerIndex = getNextPlayerIndex(state.currentPlayerIndex, state.players.length);
    const newState = {
      ...state,
      currentPlayerIndex: nextPlayerIndex,
      turnCount: state.turnCount + 1,
      phase: "drawing" /* DRAWING */,
      skipDiscardAfterZhao: false,
      // 清空响应收集状态
      pendingResponses: [],
      pendingCardSource: void 0,
      responseWindow: void 0
    };
    if (this.canAct(newState, nextPlayerIndex)) {
      newState.availableActions = this.getAvailableActions(newState);
    }
    return newState;
  }
  /**
   * 获取可用操作
   */
  getAvailableActions(state) {
    const responseActorIndex = state.phase === "response_collecting" /* RESPONSE_COLLECTING */ ? state.responseWindow?.currentResponderIndex : void 0;
    if (typeof responseActorIndex === "number" && responseActorIndex !== state.currentPlayerIndex) {
      state = { ...state, currentPlayerIndex: responseActorIndex };
    }
    const actions = [];
    const currentPlayer = state.players[state.currentPlayerIndex];
    const priorityOf = (type) => {
      const priority = RESPONSE_PRIORITY[type];
      return typeof priority === "number" ? priority : Number.MAX_SAFE_INTEGER;
    };
    const restrictByRecordedResponse = (candidateActions) => {
      if (state.phase !== "response_collecting" /* RESPONSE_COLLECTING */ || !state.responseWindow) {
        return candidateActions;
      }
      const recordedPriorities = state.responseWindow.responses.filter((response) => response.responseType !== "pass").map((response) => priorityOf(response.responseType));
      if (recordedPriorities.length === 0) {
        return candidateActions;
      }
      const highestRecordedPriority = Math.min(...recordedPriorities);
      return candidateActions.filter(
        (action) => action.type === "pass" || priorityOf(action.type) <= highestRecordedPriority
      );
    };
    if (state.isGameOver || state.phase === "ended" /* ENDED */) {
      return actions;
    }
    if (state.phase === "bao_selection" /* BAO_SELECTION */) {
      const tingCards = currentPlayer.baoTingCards || [];
      if (tingCards.length === 0) {
        return actions;
      }
      actions.push({
        type: "bao",
        cards: [],
        isMandatory: false,
        description: `\u7206\uFF08\u542C\u724C\uFF1A${tingCards.map((card) => card.rank).join("\u3001")}\uFF09`
      });
      actions.push({
        type: "pass_bao",
        cards: [],
        isMandatory: false,
        description: "\u4E0D\u7206"
      });
      return actions;
    }
    const mandatoryActions = this.rulesValidator.getMandatoryActions(state);
    if (mandatoryActions.length > 0) {
      const activeCard = state.discardPile.lastDiscard;
      const canChooseHu = state.phase === "response_collecting" /* RESPONSE_COLLECTING */ && !!activeCard && (canClaimActiveCard(state, state.currentPlayerIndex, activeCard, "hu").allowed && (this.rulesValidator.canHu(currentPlayer.cards, currentPlayer.melds, activeCard, state.pendingCardSource) || this.rulesValidator.getHuChiOptions(currentPlayer.cards, currentPlayer.melds, activeCard).length > 0));
      if (!canChooseHu) return mandatoryActions;
    }
    const addDiscardActions = () => {
      const triples = this.meldDetector.detectTriples(currentPlayer.cards);
      const lockedCardIds = /* @__PURE__ */ new Set();
      for (const meld of triples.melds) {
        for (const card of meld.cards) {
          lockedCardIds.add(card.id);
        }
      }
      const quadruples = this.meldDetector.detectQuadruples(currentPlayer.cards);
      for (const meld of quadruples.melds) {
        for (const card of meld.cards) {
          lockedCardIds.add(card.id);
        }
      }
      for (const card of currentPlayer.cards) {
        if (!lockedCardIds.has(card.id)) {
          actions.push({
            type: "discard",
            cards: [card],
            isMandatory: false,
            description: `\u51FA ${card.rank}`
          });
        }
      }
      if (false) {
        for (const card of currentPlayer.cards) {
          actions.push({
            type: "discard",
            cards: [card],
            isMandatory: false,
            description: `\u51FA ${card.rank}`
          });
        }
      }
    };
    if (state.phase === "drawing" /* DRAWING */) {
      if (currentPlayer.cards.length >= 21) {
        addDiscardActions();
      } else {
        actions.push({
          type: "draw",
          cards: [],
          isMandatory: false,
          description: "\u6478\u724C"
        });
      }
    }
    if (state.phase === "discarding" /* DISCARDING */) {
      if (state.skipDiscardAfterZhao) {
        actions.push({
          type: "pass",
          cards: [],
          isMandatory: true,
          description: "\u8DF3\u8FC7\u51FA\u724C"
        });
      } else if (currentPlayer.isBao) {
        actions.push({
          type: "pass",
          cards: [],
          isMandatory: true,
          description: "\u7206\u540E\u4E0D\u51FA\u724C"
        });
      } else {
        const dealerDiscardBaoCandidates = currentPlayer.isDealer && currentPlayer.cards.length >= 21 ? this.rulesValidator.getBaoDiscardCandidates(currentPlayer.cards, currentPlayer.melds) : [];
        for (const candidate of dealerDiscardBaoCandidates) {
          const preview = candidate.tingCards.slice(0, 4).map((card) => card.rank).join("\u3001");
          actions.push({
            type: "bao",
            cards: [candidate.discardCard],
            isMandatory: false,
            description: `\u7206\uFF08\u5F03${candidate.discardCard.rank}\u6210\u542C\uFF1A${preview}${candidate.tingCards.length > 4 ? "\u2026" : ""}\uFF09`
          });
        }
        addDiscardActions();
      }
    }
    if (state.phase === "response_collecting" /* RESPONSE_COLLECTING */ && state.discardPile.lastDiscard) {
      const targetCard = state.discardPile.lastDiscard;
      const isResponseToDiscard = state.pendingCardSource === "discard";
      const isOwnDiscard = isResponseToDiscard && state.discardPile.lastDiscardPlayerIndex === state.currentPlayerIndex;
      const isSelfDraw = state.pendingCardSource === "draw" && state.currentPlayerIndex >= 0;
      const prevPlayerIndex = getPreviousPlayerIndex(state.currentPlayerIndex, state.players.length);
      const sourcePlayerIndex = state.discardPile.lastDiscardPlayerIndex;
      const sourcePlayer = typeof sourcePlayerIndex === "number" ? state.players[sourcePlayerIndex] : void 0;
      const sourcePlayerPassedThisCard = !!sourcePlayer && hasPassedCard(sourcePlayer, targetCard);
      const canChiBySource = isResponseToDiscard && sourcePlayerIndex === prevPlayerIndex || state.pendingCardSource === "draw" && // 翻牌者自身响应
      (sourcePlayerIndex === state.currentPlayerIndex || // 翻牌者已过牌（passedPlays 有记录），吃权已转给下家（来源=上家）
      sourcePlayerPassedThisCard && sourcePlayerIndex === prevPlayerIndex);
      const hasPassedThisCard = hasPassedCard(currentPlayer, targetCard);
      if (!currentPlayer.isBao && canChiBySource && !hasPassedThisCard && this.rulesValidator.canChi(currentPlayer.cards, targetCard)) {
        const chiOptions = this.rulesValidator.getValidChiOptions(currentPlayer.cards, targetCard);
        if (chiOptions.length > 0) {
          const chiSelection = chiOptions[0].selectedCards;
          actions.push({
            type: "chi",
            cards: chiSelection,
            chiOptions,
            isMandatory: false,
            description: "\u5403\u724C"
          });
        }
      }
      if (!currentPlayer.isBao && (!isOwnDiscard || isSelfDraw) && this.rulesValidator.canPeng(currentPlayer.cards, targetCard)) {
        actions.push({
          type: "peng",
          cards: [targetCard],
          isMandatory: false,
          description: "\u78B0\u724C"
        });
      }
      if ((!isOwnDiscard || isSelfDraw) && this.rulesValidator.canZhao(currentPlayer.cards, targetCard)) {
        actions.push({
          type: "zhao",
          cards: [targetCard],
          isMandatory: false,
          description: "\u62DB\u724C"
        });
      }
    }
    const canHuBySource = state.phase === "response_collecting" /* RESPONSE_COLLECTING */ && !(state.pendingCardSource === "discard" && state.discardPile.lastDiscardPlayerIndex === state.currentPlayerIndex) || state.phase === "discarding" /* DISCARDING */;
    const huActiveCard = state.phase === "response_collecting" /* RESPONSE_COLLECTING */ ? state.discardPile.lastDiscard : void 0;
    const canClaimHu = !!huActiveCard && canClaimActiveCard(state, state.currentPlayerIndex, huActiveCard, "hu").allowed;
    const huViaDirect = canHuBySource && canClaimHu && this.rulesValidator.canHu(
      currentPlayer.cards,
      currentPlayer.melds,
      huActiveCard,
      state.pendingCardSource
    );
    const huChiOptions = canHuBySource && canClaimHu ? this.rulesValidator.getHuChiOptions(currentPlayer.cards, currentPlayer.melds, huActiveCard) : [];
    if (huViaDirect || huChiOptions.length > 0) {
      actions.push({
        type: "hu",
        cards: [],
        huOptions: huChiOptions.length > 0 ? huChiOptions : void 0,
        isMandatory: false,
        description: "\u80E1\u724C"
      });
    }
    if (state.phase === "response_collecting" /* RESPONSE_COLLECTING */) {
      actions.push({
        type: "pass",
        cards: [],
        isMandatory: false,
        description: "\u8FC7"
      });
    }
    if (state.phase === "response_collecting" /* RESPONSE_COLLECTING */ && actions.some((action) => action.type === "hu")) {
      const targetCard = state.discardPile.lastDiscard;
      const forcedType = targetCard && state.ruleProfile?.mandatoryZhao !== false && this.rulesValidator.canZhao(currentPlayer.cards, targetCard) ? "zhao" : targetCard && state.ruleProfile?.mandatoryPeng !== false && !currentPlayer.isBao && this.rulesValidator.canPeng(currentPlayer.cards, targetCard) ? "peng" : void 0;
      if (forcedType) {
        return restrictByRecordedResponse(actions.filter((action) => action.type === "hu" || action.type === forcedType).map((action) => action.type === forcedType ? { ...action, isMandatory: true } : action).sort((left, right) => priorityOf(left.type) - priorityOf(right.type)));
      }
    }
    return restrictByRecordedResponse(actions);
  }
  /**
   * 检查游戏是否结束
   * 注意：胡牌由玩家主动操作触发，这里只检查牌堆耗尽和回合数超限
   */
  checkGameEnd(state) {
    if (state.isGameOver) {
      const winnerIndex = state.players.findIndex((p) => p.totalScore > 0);
      return { ended: true, winnerIndex: winnerIndex >= 0 ? winnerIndex : void 0 };
    }
    if (state.remainingDeckCards <= 0) {
      if (state.phase === "response_collecting" /* RESPONSE_COLLECTING */ || state.phase === "discarding" /* DISCARDING */) {
        return { ended: false };
      }
      return { ended: true };
    }
    if (state.turnCount > 200) {
      return { ended: true };
    }
    return { ended: false };
  }
  /**
   * 检查玩家是否可以行动
   */
  canAct(state, playerIndex) {
    if (state.isGameOver) return false;
    if (playerIndex !== state.currentPlayerIndex) return false;
    return true;
  }
};

// src/game-engine/opening-facts.ts
function canDeclareHeavenlyWin(context) {
  return context.winnerIndex === context.dealerIndex && (context.openingPhase === "bao_selection" || context.openingPhase === "dealer_pending_resolution") && context.ordinaryActionCount === 0 && context.drawOrdinal === 0;
}
function isFirstMountainFlipWin(context, drawOrdinal) {
  return context.source === "draw" && context.sourcePlayerIndex === context.winnerIndex && drawOrdinal === 1;
}
function openingMingTangContext(state, winnerIndex) {
  const dealerIndex = state.players.findIndex((player) => player.isDealer);
  return {
    dealerIndex,
    winnerIndex,
    openingPhase: state.openingPhase || "normal",
    ordinaryActionCount: state.openingFacts?.ordinaryActionCount || 0,
    drawOrdinal: state.drawOrdinal || 0,
    source: state.pendingCardSource,
    sourcePlayerIndex: state.discardPile.lastDiscardPlayerIndex
  };
}

// src/game-engine/action-handlers.ts
var ActionHandlers = class {
  constructor() {
    this.meldDetector = new MeldDetector();
    this.scoreCalculator = new ScoreCalculator();
    this.rulesValidator = new RulesValidator();
    this.gameConfig = DEFAULT_GAME_CONFIG;
  }
  setConfig(config) {
    this.gameConfig = config;
  }
  hasShaBao(state, winnerIndex) {
    return state.players.some((player, index) => index !== winnerIndex && !!player.isBao);
  }
  /**
   * 处理摸牌（翻牌）
   */
  handleDraw(state, deck) {
    const drawnCard = deckManager.draw(deck);
    if (!drawnCard) {
      return { state };
    }
    const newDiscardPile = {
      ...state.discardPile,
      lastDiscard: drawnCard,
      lastDiscardPlayerIndex: state.currentPlayerIndex
    };
    return {
      state: {
        ...state,
        discardPile: newDiscardPile,
        phase: "response_collecting" /* RESPONSE_COLLECTING */,
        pendingCardSource: "draw",
        skipDiscardAfterZhao: false,
        pendingResponses: [],
        remainingDeckCards: deckManager.remainingCount(deck)
      },
      drawnCard
    };
  }
  /**
   * 处理出牌
   * R8.3.2: 八块玩家可以跳过出牌
   */
  handleDiscard(state, card) {
    const currentPlayer = state.players[state.currentPlayerIndex];
    const newCards = currentPlayer.cards.filter((c) => c.id !== card.id);
    const newDiscardPile = {
      ...state.discardPile,
      cards: [...state.discardPile.cards, card],
      discardHistory: [
        ...state.discardPile.discardHistory || [],
        {
          card,
          sourcePlayerIndex: state.currentPlayerIndex,
          playerIndex: state.currentPlayerIndex,
          source: "discard",
          sequence: (state.discardPile.discardHistory || []).length + 1
        }
      ],
      lastDiscard: card,
      lastDiscardPlayerIndex: state.currentPlayerIndex
    };
    const updatedPlayers = [...state.players];
    const discardAsPassed = {
      card,
      timestamp: Date.now(),
      actionType: "discard"
    };
    updatedPlayers[state.currentPlayerIndex] = {
      ...currentPlayer,
      cards: newCards,
      // 新增规则：玩家自己打出过的牌也纳入过张，不可再吃同名牌
      passedPlays: [...currentPlayer.passedPlays, discardAsPassed]
    };
    return {
      ...state,
      players: updatedPlayers,
      discardPile: newDiscardPile,
      phase: "response_collecting" /* RESPONSE_COLLECTING */,
      skipDiscardAfterZhao: false,
      pendingResponses: [],
      pendingCardSource: "discard"
    };
  }
  /**
   * R8.3.2: 检查玩家是否可以跳过出牌（八块特权）
   */
  canSkipDiscard(state, playerIndex) {
    return state.currentPlayerIndex === playerIndex && !!state.skipDiscardAfterZhao;
  }
  /**
   * R8.3.2: 处理八块跳过出牌
   */
  handleSkipDiscard(state) {
    if (!state.skipDiscardAfterZhao) {
      return state;
    }
    return this.nextPlayer(state);
  }
  /**
  * 检查是否可以吃牌（包含R4.3.1只吃下家、R4.3.3过张规则）
   * @param state 游戏状态
   * @param playerIndex 想要吃牌的玩家索引
   * @param targetCard 目标牌
   * @returns 是否可以吃牌及原因
   */
  canPlayerChi(state, playerIndex, targetCard) {
    const player = state.players[playerIndex];
    const discardPlayerIndex = state.discardPile.lastDiscardPlayerIndex;
    const isSelfDrawCard = state.pendingCardSource === "draw" && playerIndex === discardPlayerIndex;
    const sourcePlayer = typeof discardPlayerIndex === "number" ? state.players[discardPlayerIndex] : void 0;
    const sourcePlayerPassedThisCard = !!sourcePlayer && hasPassedCard(sourcePlayer, targetCard);
    if (player.isBao) {
      return { canChi: false, reason: "\u7206\u724C\u540E\u4E0D\u80FD\u5403\u724C" };
    }
    if (state.pendingCardSource === "draw" && !isSelfDrawCard && discardPlayerIndex !== void 0) {
      if (!sourcePlayerPassedThisCard) {
        return { canChi: false, reason: "\u7FFB\u724C\u8005\u9700\u5148\u51B3\u5B9A\u662F\u5426\u5403\u724C" };
      }
      const expectedPrevForDraw = getPreviousPlayerIndex(playerIndex, state.players.length);
      if (discardPlayerIndex !== expectedPrevForDraw) {
        return { canChi: false, reason: "\u53EA\u6709\u7FFB\u724C\u8005\u7684\u4E0B\u5BB6\u624D\u80FD\u5403" };
      }
    }
    if (!isSelfDrawCard && discardPlayerIndex !== void 0) {
      const expectedPrevPlayer = getPreviousPlayerIndex(playerIndex, state.players.length);
      if (discardPlayerIndex !== expectedPrevPlayer) {
        return { canChi: false, reason: "\u53EA\u80FD\u5403\u4E0A\u5BB6\u7684\u724C\u6216\u81EA\u5DF1\u7FFB\u7684\u724C" };
      }
    }
    const hasPassedThisCard = hasPassedCard(player, targetCard);
    if (hasPassedThisCard) {
      return { canChi: false, reason: "\u5DF2\u8FC7\u5F20\uFF0C\u4E0D\u80FD\u518D\u5403\u6B64\u724C" };
    }
    const chiOptions = this.rulesValidator.getValidChiOptions(player.cards, targetCard);
    if (chiOptions.length === 0) {
      return { canChi: false, reason: "\u624B\u724C\u65E0\u6CD5\u7EC4\u6210\u987A\u5B50" };
    }
    const validSelection = chiOptions[0]?.selectedCards;
    if (!validSelection) {
      return { canChi: false, reason: "\u4E0D\u80FD\u62C6\u574E/\u5785\u5403\u724C" };
    }
    return { canChi: true };
  }
  /**
   * 处理吃牌（含R4.3.1、R4.3.3、R7.8规则）
   */
  handleChi(state, playerId, cards, chiOptionId) {
    const playerIndex = state.players.findIndex((p) => p.playerId === playerId);
    if (playerIndex === -1) return state;
    const player = state.players[playerIndex];
    const targetCard = state.discardPile.lastDiscard;
    if (!targetCard) return state;
    const chiCheck = this.canPlayerChi(state, playerIndex, targetCard);
    if (!chiCheck.canChi) {
      return state;
    }
    const chiOptions = this.rulesValidator.getValidChiOptions(player.cards, targetCard);
    let selectedOption = chiOptionId ? chiOptions.find((option) => option.id === chiOptionId) : void 0;
    if (!selectedOption) {
      selectedOption = chiOptions.find((option) => this.isSameSelection(option.selectedCards, cards));
    }
    if (!selectedOption) {
      selectedOption = chiOptions[0];
      if (!selectedOption) {
        return state;
      }
    }
    const selectedCards = selectedOption.selectedCards;
    const allChiCards = [...selectedCards, targetCard];
    const displayChiCards = [targetCard, ...selectedCards];
    const chiMeldType = this.rulesValidator.detectChiMeldType(allChiCards);
    if (!chiMeldType) {
      return state;
    }
    const isFromDiscard = state.pendingCardSource === "discard";
    const newDiscardPile = {
      ...state.discardPile,
      cards: isFromDiscard ? state.discardPile.cards.slice(0, -1) : state.discardPile.cards,
      discardHistory: isFromDiscard ? (state.discardPile.discardHistory || []).slice(0, -1) : state.discardPile.discardHistory,
      lastDiscard: isFromDiscard ? state.discardPile.cards[state.discardPile.cards.length - 2] || void 0 : void 0,
      lastDiscardPlayerIndex: void 0
    };
    const meld = {
      type: chiMeldType,
      cards: displayChiCards,
      isConcealed: false,
      position: "table",
      huPoints: 0
    };
    meld.huPoints = this.scoreCalculator.calculateMeldHuPoints(meld);
    const allMelds = [meld, ...selectedOption.additionalMelds];
    const updatedPlayers = [...state.players];
    updatedPlayers[playerIndex] = {
      ...player,
      cards: selectedOption.remainingCards,
      melds: [...player.melds, ...allMelds],
      chiHistory: [...player.chiHistory, targetCard]
    };
    return {
      ...state,
      players: updatedPlayers,
      discardPile: newDiscardPile,
      currentPlayerIndex: playerIndex,
      phase: "discarding" /* DISCARDING */,
      skipDiscardAfterZhao: false,
      pendingResponses: [],
      pendingCardSource: void 0
    };
  }
  isValidChiSelection(handCards, selectedCards, targetCard) {
    if (!selectedCards || selectedCards.length !== 2) return false;
    const selectedIds = selectedCards.map((c) => c.id);
    if (new Set(selectedIds).size !== 2) return false;
    const handIds = new Set(handCards.map((c) => c.id));
    if (!selectedIds.every((id) => handIds.has(id))) return false;
    const lockedCardIds = this.getLockedMeldCardIds(handCards);
    if (selectedCards.some((c) => lockedCardIds.has(c.id))) return false;
    const meldCards = [...selectedCards, targetCard];
    const meldType = this.rulesValidator.detectChiMeldType(meldCards);
    if (!meldType) return false;
    return this.rulesValidator.isValidMeld(meldCards, meldType);
  }
  findFirstValidChiSelection(handCards, targetCard) {
    return this.rulesValidator.getValidChiOptions(handCards, targetCard)[0]?.selectedCards || null;
  }
  isSameSelection(left, right) {
    if (!left || !right || left.length !== right.length) {
      return false;
    }
    const leftIds = left.map((card) => card.id).sort();
    const rightIds = right.map((card) => card.id).sort();
    return leftIds.every((id, index) => id === rightIds[index]);
  }
  getLockedMeldCardIds(handCards) {
    const locked = /* @__PURE__ */ new Set();
    const triples = this.meldDetector.detectTriples(handCards).melds;
    const quads = this.meldDetector.detectQuadruples(handCards).melds;
    for (const meld of [...triples, ...quads]) {
      for (const card of meld.cards) {
        locked.add(card.id);
      }
    }
    return locked;
  }
  /**
   * 处理碰牌
   */
  handlePeng(state, playerId) {
    const playerIndex = state.players.findIndex((p) => p.playerId === playerId);
    if (playerIndex === -1) return state;
    const player = state.players[playerIndex];
    const targetCard = state.discardPile.lastDiscard;
    if (!targetCard) return state;
    const isFromDiscard = state.pendingCardSource === "discard";
    const newDiscardPile = {
      ...state.discardPile,
      cards: isFromDiscard ? state.discardPile.cards.slice(0, -1) : state.discardPile.cards,
      discardHistory: isFromDiscard ? (state.discardPile.discardHistory || []).slice(0, -1) : state.discardPile.discardHistory,
      lastDiscard: isFromDiscard ? state.discardPile.cards[state.discardPile.cards.length - 2] || void 0 : void 0,
      lastDiscardPlayerIndex: void 0
    };
    const sameCards = player.cards.filter(
      (c) => c.rank === targetCard.rank && c.size === targetCard.size
    ).slice(0, 2);
    const meld = {
      type: "peng" /* PENG */,
      cards: [...sameCards, targetCard],
      isConcealed: false,
      position: "table",
      huPoints: 0
    };
    meld.huPoints = this.scoreCalculator.calculateMeldHuPoints(meld);
    const remainingCards = player.cards.filter(
      (c) => !sameCards.some((sc) => sc.id === c.id)
    );
    const updatedPlayers = [...state.players];
    updatedPlayers[playerIndex] = {
      ...player,
      cards: remainingCards,
      melds: [...player.melds, meld]
    };
    return {
      ...state,
      players: updatedPlayers,
      discardPile: newDiscardPile,
      currentPlayerIndex: playerIndex,
      phase: "discarding" /* DISCARDING */,
      skipDiscardAfterZhao: false,
      pendingResponses: [],
      pendingCardSource: void 0
    };
  }
  /**
   * 处理招牌
   */
  handleZhao(state, playerId) {
    const playerIndex = state.players.findIndex((p) => p.playerId === playerId);
    if (playerIndex === -1) return state;
    const player = state.players[playerIndex];
    const targetCard = state.discardPile.lastDiscard;
    if (!targetCard) return state;
    const isFromDiscard = state.pendingCardSource === "discard";
    const newDiscardPile = {
      ...state.discardPile,
      cards: isFromDiscard ? state.discardPile.cards.slice(0, -1) : state.discardPile.cards,
      discardHistory: isFromDiscard ? (state.discardPile.discardHistory || []).slice(0, -1) : state.discardPile.discardHistory,
      lastDiscard: isFromDiscard ? state.discardPile.cards[state.discardPile.cards.length - 2] || void 0 : void 0,
      lastDiscardPlayerIndex: void 0
    };
    const sameCards = player.cards.filter(
      (c) => c.rank === targetCard.rank && c.size === targetCard.size
    ).slice(0, 3);
    const meld = {
      type: "draw_quadruple" /* DRAW_QUADRUPLE */,
      cards: [...sameCards, targetCard],
      isConcealed: false,
      position: "table",
      huPoints: 0
    };
    meld.huPoints = this.scoreCalculator.calculateMeldHuPoints(meld);
    const remainingCards = player.cards.filter(
      (c) => !sameCards.some((sc) => sc.id === c.id)
    );
    const allMelds = [...player.melds, meld];
    const hasEight = hasEightBlocks(
      allMelds.filter((m) => m.type === "quadruple" /* QUADRUPLE */).length,
      allMelds.filter((m) => m.type === "draw_quadruple" /* DRAW_QUADRUPLE */).length
    );
    const updatedPlayers = [...state.players];
    updatedPlayers[playerIndex] = {
      ...player,
      cards: remainingCards,
      melds: allMelds,
      hasEightBlocks: hasEight
    };
    return {
      ...state,
      players: updatedPlayers,
      discardPile: newDiscardPile,
      currentPlayerIndex: playerIndex,
      phase: "discarding" /* DISCARDING */,
      skipDiscardAfterZhao: hasEight || !!player.isBao,
      pendingResponses: [],
      pendingCardSource: void 0
    };
  }
  /**
   * 处理胡牌（R5.3.1/2 点炮/自摸计分）
   * @param state 游戏状态
   * @param playerId 胡牌玩家ID
   * @param isSelfDraw 是否自摸（翻牌胡）
   */
  handleHu(state, playerId, isSelfDraw = false, huOptionId) {
    const playerIndex = state.players.findIndex((p) => p.playerId === playerId);
    if (playerIndex === -1) return state;
    const player = state.players[playerIndex];
    const activeCard = state.phase === "response_collecting" /* RESPONSE_COLLECTING */ ? state.discardPile.lastDiscard : void 0;
    let effectiveHandCards = activeCard ? [...player.cards, activeCard] : player.cards;
    let landedMelds = [...player.melds];
    if (activeCard) {
      const huChiOptions = this.rulesValidator.getHuChiOptions(player.cards, player.melds, activeCard);
      const resolvedHuOption = huOptionId ? huChiOptions.find((option) => option.id === huOptionId) : huChiOptions[0];
      if (resolvedHuOption) {
        const mainMeldType = this.rulesValidator.detectChiMeldType(resolvedHuOption.mainMeldCards);
        if (mainMeldType) {
          const mainMeld = {
            type: mainMeldType,
            cards: resolvedHuOption.mainMeldCards,
            isConcealed: false,
            position: "table",
            huPoints: 0
          };
          mainMeld.huPoints = this.scoreCalculator.calculateMeldHuPoints(mainMeld);
          effectiveHandCards = resolvedHuOption.remainingCards;
          landedMelds = [...player.melds, mainMeld, ...resolvedHuOption.additionalMelds];
        }
      }
    }
    const heavenlyWinCards = activeCard ? [...player.cards, activeCard] : player.cards;
    const winningHandMelds = this.rulesValidator.findWinningHandMelds(
      effectiveHandCards,
      landedMelds,
      activeCard,
      state.pendingCardSource
    );
    if (!winningHandMelds) {
      return state;
    }
    const finalMelds = winningHandMelds ? [...landedMelds, ...winningHandMelds] : landedMelds;
    const openingFacts = openingMingTangContext(state, playerIndex);
    const isHeavenlyWin2 = canDeclareHeavenlyWin(openingFacts) && this.rulesValidator.checkHeavenlyWin(heavenlyWinCards);
    const isDrawResponseWin = state.pendingCardSource === "draw" && state.discardPile.lastDiscardPlayerIndex === playerIndex;
    const isActualSelfDraw = isSelfDraw || isDrawResponseWin;
    const isDiscardWin = !isActualSelfDraw && state.discardPile.lastDiscardPlayerIndex !== void 0 && state.discardPile.lastDiscardPlayerIndex !== playerIndex && state.pendingCardSource !== "draw";
    const isBaoWin = !!player.isBao;
    const isShaBao = this.hasShaBao(state, playerIndex);
    const scoreResult = this.scoreCalculator.calculateTotalScore(finalMelds, {
      winType: isActualSelfDraw ? "self_draw" /* SELF_DRAW */ : void 0,
      isHeavenlyWin: isHeavenlyWin2,
      isFirstDrawWin: isDrawResponseWin && isFirstMountainFlipWin(openingFacts, state.drawOrdinal || 0),
      isLastDrawWin: isDrawResponseWin && state.remainingDeckCards === 0,
      isBaoWin,
      isShaBao,
      enabledMingTangTypes: this.gameConfig.enabledMingTangTypes
    });
    const { totalHuPoints, baseScore, finalScore, roundScore, mingtangs, totalFans } = scoreResult;
    const winType = isDiscardWin ? "discard" /* DISCARD */ : "self_draw" /* SELF_DRAW */;
    const settlementScore = finalScore;
    let dianpaoPlayerIndex;
    if (isDiscardWin && state.discardPile.lastDiscardPlayerIndex !== void 0) {
      dianpaoPlayerIndex = state.discardPile.lastDiscardPlayerIndex;
    }
    const updatedPlayers = [...state.players];
    if (isDiscardWin) {
      const payment = settlementScore * 2;
      for (let i = 0; i < updatedPlayers.length; i++) {
        if (i === playerIndex) {
          updatedPlayers[i] = {
            ...updatedPlayers[i],
            melds: finalMelds,
            cards: [],
            totalScore: payment
          };
        } else if (i === dianpaoPlayerIndex) {
          updatedPlayers[i] = {
            ...updatedPlayers[i],
            totalScore: -payment
          };
        }
      }
    } else {
      const winnerGain = settlementScore * 2;
      for (let i = 0; i < updatedPlayers.length; i++) {
        if (i === playerIndex) {
          updatedPlayers[i] = {
            ...updatedPlayers[i],
            melds: finalMelds,
            cards: [],
            totalScore: winnerGain
          };
        } else {
          updatedPlayers[i] = {
            ...updatedPlayers[i],
            totalScore: -settlementScore
          };
        }
      }
    }
    return {
      ...state,
      players: updatedPlayers,
      phase: "ended" /* ENDED */,
      isGameOver: true,
      skipDiscardAfterZhao: false,
      winnerIndex: playerIndex,
      winType,
      dianpaoPlayerIndex,
      winningMingTangs: mingtangs,
      totalFans,
      winningHuPoints: totalHuPoints,
      winningBaseScore: baseScore,
      winningRoundScore: roundScore,
      pendingResponses: [],
      pendingCardSource: void 0
    };
  }
  /**
   * 处理过/放弃（记录过张）
   * @param state 游戏状态
   * @param playerId 玩家ID
   * @param passedActionType 放弃的操作类型（用于R4.3.3过张记录）
   */
  handlePass(state, playerId, passedActionType) {
    const playerIndex = state.players.findIndex((p) => p.playerId === playerId);
    if (passedActionType === "chi" && state.discardPile.lastDiscard) {
      if (playerIndex < 0 || !this.canPlayerChi(state, playerIndex, state.discardPile.lastDiscard).canChi) {
        return state;
      }
      const updatedPlayers = [...state.players];
      const player = updatedPlayers[playerIndex];
      const passedPlay = {
        card: state.discardPile.lastDiscard,
        timestamp: Date.now(),
        actionType: "chi"
      };
      updatedPlayers[playerIndex] = {
        ...player,
        passedPlays: [...player.passedPlays, passedPlay]
      };
      return {
        ...state,
        players: updatedPlayers
      };
    }
    return state;
  }
  /**
   * 移动到下一个玩家
   */
  nextPlayer(state) {
    const nextIndex = getNextPlayerIndex(state.currentPlayerIndex, state.players.length);
    return {
      ...state,
      currentPlayerIndex: nextIndex,
      phase: "drawing" /* DRAWING */,
      skipDiscardAfterZhao: false,
      pendingResponses: [],
      pendingCardSource: void 0
    };
  }
};

// src/game-engine/game-manager.ts
var GameManager = class {
  constructor(clock = () => Date.now()) {
    this.deck = [];
    this.currentConfig = DEFAULT_GAME_CONFIG;
    this.clock = clock;
    this.deckManager = new DeckManager();
    this.turnManager = new TurnManager();
    this.actionHandlers = new ActionHandlers();
    this.rulesValidator = new RulesValidator();
    this.meldDetector = new MeldDetector();
    this.scoreCalculator = new ScoreCalculator();
  }
  getRemainingDeckSnapshot() {
    return this.deck.map((card) => ({ ...card }));
  }
  setRemainingDeckSnapshot(deck) {
    this.deck = deck.map((card) => ({ ...card }));
  }
  now() {
    return this.clock();
  }
  snapshotRuleProfile(config) {
    return {
      ruleVersion: config.ruleVersion,
      playerCount: 3,
      bottomCardCount: config.bottomCardCount,
      enabledMingTangTypes: { ...config.enabledMingTangTypes },
      guoZhangClearPolicy: config.guoZhangClearPolicy,
      rotatingDealer: config.rotatingDealer,
      mandatoryPeng: config.mandatoryPeng,
      mandatoryZhao: config.mandatoryZhao,
      minHuPoints: config.minHuPoints,
      allowZeroHu: config.allowZeroHu,
      maxTurns: config.maxTurns,
      responseTimeout: config.responseTimeout,
      minResponseTimeout: config.minResponseTimeout,
      maxResponseTimeout: config.maxResponseTimeout
    };
  }
  responseTimeoutMs() {
    return Math.min(
      this.currentConfig.maxResponseTimeout,
      Math.max(this.currentConfig.minResponseTimeout, this.currentConfig.responseTimeout)
    );
  }
  timeoutActionFor(actions) {
    if (actions.some((action) => action.type === "zhao" && action.isMandatory)) {
      return "timeout_zhao";
    }
    if (actions.some((action) => action.type === "peng" && action.isMandatory)) {
      return "timeout_peng";
    }
    return "timeout_pass";
  }
  normalizeTimeoutAction(state, action) {
    if (!action.type.startsWith("timeout_")) {
      return action;
    }
    const window = state.responseWindow;
    const responderIndex = window?.currentResponderIndex;
    if (state.phase !== "response_collecting" /* RESPONSE_COLLECTING */ || !window || typeof responderIndex !== "number" || action.isSystem !== true || action.responseWindowId !== window.id || action.type !== window.timeoutAction || this.now() < window.deadlineAt || state.players[responderIndex]?.playerId !== action.playerId) {
      return null;
    }
    const normalizedType = action.type === "timeout_peng" ? "peng" : action.type === "timeout_zhao" ? "zhao" : "pass";
    const offered = this.turnManager.getAvailableActions(state);
    if (!offered.some((candidate) => candidate.type === normalizedType)) {
      return null;
    }
    return { ...action, type: normalizedType, isSystem: true };
  }
  materializePendingDrawCard(state, responseWindowId) {
    if (state.pendingCardSource !== "draw" || !state.discardPile.lastDiscard) {
      return state;
    }
    const targetCard = state.discardPile.lastDiscard;
    const alreadyInDiscard = (state.discardPile.cards || []).some((card) => card.id === targetCard.id);
    const alreadyInHistory = (state.discardPile.discardHistory || []).some((entry) => entry.card.id === targetCard.id);
    if (alreadyInDiscard && alreadyInHistory) {
      return state;
    }
    return {
      ...state,
      discardPile: {
        ...state.discardPile,
        cards: alreadyInDiscard ? state.discardPile.cards : [...state.discardPile.cards || [], targetCard],
        discardHistory: alreadyInHistory ? state.discardPile.discardHistory : [
          ...state.discardPile.discardHistory || [],
          {
            card: targetCard,
            sourcePlayerIndex: state.discardPile.lastDiscardPlayerIndex ?? state.currentPlayerIndex,
            playerIndex: state.discardPile.lastDiscardPlayerIndex ?? state.currentPlayerIndex,
            source: "draw",
            responseWindowId,
            sequence: (state.discardPile.discardHistory || []).length + 1
          }
        ]
      }
    };
  }
  getActingPlayerIndex(state) {
    return state.phase === "response_collecting" /* RESPONSE_COLLECTING */ && typeof state.responseWindow?.currentResponderIndex === "number" ? state.responseWindow.currentResponderIndex : state.currentPlayerIndex;
  }
  getResponseActions(state, playerIndex) {
    if (!state.responseWindow) return [];
    return this.turnManager.getAvailableActions({
      ...state,
      responseWindow: { ...state.responseWindow, currentResponderIndex: playerIndex }
    });
  }
  appendResponse(state, response) {
    const responses = [
      ...(state.responseWindow?.responses || []).filter((item) => item.playerIndex !== response.playerIndex),
      response
    ];
    return {
      ...state,
      pendingResponses: responses,
      responseWindow: state.responseWindow ? { ...state.responseWindow, responses } : void 0
    };
  }
  resolveResponseWindow(state) {
    const window = state.responseWindow;
    if (!window) return state;
    const arbitrationState = { ...state, pendingResponses: window.responses };
    const winner = this.turnManager.resolveResponses(arbitrationState).winningResponse;
    if (!winner) {
      const materialized = this.materializePendingDrawCard({
        ...arbitrationState,
        currentPlayerIndex: window.sourcePlayerIndex,
        responseWindow: void 0
      }, window.id);
      return this.turnManager.endTurn(this.completeOpeningResolution(materialized));
    }
    const playerId = state.players[winner.playerIndex].playerId;
    const actionState = {
      ...arbitrationState,
      currentPlayerIndex: winner.playerIndex,
      responseWindow: void 0
    };
    let resolvedState;
    switch (winner.responseType) {
      case "chi":
        resolvedState = this.actionHandlers.handleChi(actionState, playerId, winner.cards, winner.chiOptionId);
        break;
      case "peng":
        resolvedState = this.actionHandlers.handlePeng(actionState, playerId);
        break;
      case "zhao":
        resolvedState = this.actionHandlers.handleZhao(actionState, playerId);
        break;
      case "hu":
        resolvedState = this.actionHandlers.handleHu(
          actionState,
          playerId,
          window.source === "draw" && window.sourcePlayerIndex === winner.playerIndex,
          winner.huOptionId
        );
        break;
      default:
        resolvedState = this.turnManager.endTurn({ ...actionState, currentPlayerIndex: window.sourcePlayerIndex });
        break;
    }
    return winner.responseType === "hu" ? resolvedState : this.markOrdinaryAction(this.completeOpeningResolution(resolvedState));
  }
  advanceResponseWindow(state, _startPosition) {
    const window = state.responseWindow;
    if (!window) return state;
    let nextState = state;
    const respondedPlayers = new Set(window.responses.map((response) => response.playerIndex));
    const priorityOf = (action) => {
      const priority = RESPONSE_PRIORITY[action.type];
      return typeof priority === "number" ? priority : Number.MAX_SAFE_INTEGER;
    };
    const recordedPriorities = window.responses.filter((response) => response.responseType !== "pass").map((response) => {
      const priority = RESPONSE_PRIORITY[response.responseType];
      return typeof priority === "number" ? priority : Number.MAX_SAFE_INTEGER;
    });
    const highestRecordedPriority = recordedPriorities.length > 0 ? Math.min(...recordedPriorities) : Number.MAX_SAFE_INTEGER;
    const candidates = [];
    for (let position = 0; position < window.responderOrder.length; position++) {
      const playerIndex = window.responderOrder[position];
      if (respondedPlayers.has(playerIndex)) continue;
      const candidate = {
        ...nextState,
        responseWindow: { ...nextState.responseWindow, currentResponderIndex: playerIndex }
      };
      const actions = this.getResponseActions(candidate, playerIndex);
      const competitiveActions = actions.filter(
        (action) => action.type !== "pass" && priorityOf(action) <= highestRecordedPriority
      );
      if (competitiveActions.length > 0) {
        candidates.push({
          position,
          playerIndex,
          state: candidate,
          // 这一层只决定当前响应者；选中后保留该玩家完整合法动作集。
          actions
        });
        continue;
      }
      nextState = this.appendResponse(candidate, {
        playerIndex,
        responseType: "pass",
        cards: [],
        timestamp: Date.now()
      });
      respondedPlayers.add(playerIndex);
    }
    if (!candidates.length) {
      return this.resolveResponseWindow({
        ...nextState,
        responseWindow: { ...nextState.responseWindow, currentResponderIndex: void 0 },
        availableActions: []
      });
    }
    const highestPriority = Math.min(
      ...candidates.flatMap((candidate) => candidate.actions.filter((action) => action.type !== "pass").map(priorityOf))
    );
    const selected = candidates.find((candidate) => candidate.actions.some(
      (action) => action.type !== "pass" && priorityOf(action) === highestPriority
    ));
    const selectedActions = selected.actions;
    const mandatoryAction = selectedActions.find(
      (action) => action.isMandatory && action.type !== "pass"
    );
    const hasHuFallback = selectedActions.some((action) => action.type === "hu");
    const hasMandatoryHuFallback = !!mandatoryAction && hasHuFallback;
    if (mandatoryAction && !hasHuFallback) {
      const resolvedState = this.appendResponse(selected.state, {
        playerIndex: selected.playerIndex,
        responseType: mandatoryAction.type,
        cards: mandatoryAction.cards || [],
        timestamp: Date.now(),
        chiOptionId: mandatoryAction.chiOptions?.[0]?.id,
        huOptionId: mandatoryAction.huOptions?.[0]?.id
      });
      return this.resolveResponseWindow({
        ...resolvedState,
        responseWindow: { ...resolvedState.responseWindow, currentResponderIndex: void 0 },
        availableActions: []
      });
    }
    return {
      ...selected.state,
      responseWindow: {
        ...selected.state.responseWindow,
        currentResponderIndex: selected.playerIndex,
        timeoutAction: this.timeoutActionFor(selectedActions)
      },
      availableActions: hasMandatoryHuFallback ? selectedActions.filter((action) => action.type !== "pass") : selectedActions
    };
  }
  openResponseWindow(state) {
    const activeCard = state.discardPile.lastDiscard;
    const source = state.pendingCardSource;
    const sourcePlayerIndex = state.discardPile.lastDiscardPlayerIndex;
    if (state.phase !== "response_collecting" /* RESPONSE_COLLECTING */ || !activeCard || !source || typeof sourcePlayerIndex !== "number") {
      return state;
    }
    const responderOrder = getResponderOrder(source, sourcePlayerIndex, state.players.length);
    const openedAt = this.now();
    const responseWindowId = `${state.turnCount}:${source}:${activeCard.id}`;
    const discardHistory = state.discardPile.discardHistory?.map(
      (entry, index, history) => index === history.length - 1 && entry.card.id === activeCard.id ? { ...entry, responseWindowId } : entry
    );
    const opened = {
      ...state,
      pendingResponses: [],
      discardPile: discardHistory ? { ...state.discardPile, discardHistory } : state.discardPile,
      responseWindow: {
        id: responseWindowId,
        source,
        sourcePlayerIndex,
        activeCard,
        responderOrder,
        responses: [],
        openedAt,
        deadlineAt: openedAt + this.responseTimeoutMs(),
        timeoutAction: "timeout_pass"
      }
    };
    return this.advanceResponseWindow(opened, 0);
  }
  processWindowResponse(state, action, offered) {
    const window = state.responseWindow;
    if (!window || typeof window.currentResponderIndex !== "number") return state;
    const playerIndex = window.currentResponderIndex;
    if (state.players[playerIndex]?.playerId !== action.playerId) return { ...state, availableActions: offered };
    let responseState = state;
    if (action.type === "pass" && offered.some((item) => item.type === "chi")) {
      responseState = this.actionHandlers.handlePass(state, action.playerId, "chi");
    }
    responseState = this.appendResponse(responseState, {
      playerIndex,
      responseType: action.type,
      cards: action.cards || [],
      timestamp: action.timestamp || Date.now(),
      chiOptionId: action.chiOptionId,
      huOptionId: action.huOptionId
    });
    const position = window.responderOrder.indexOf(playerIndex);
    return this.advanceResponseWindow(responseState, position + 1);
  }
  /**
   * 起手垅牌必晒：把手牌中的4张相同牌移到置牌区
   */
  applyStartLong(player) {
    const detected = this.meldDetector.detectQuadruples(player.cards);
    if (detected.melds.length === 0) {
      return player;
    }
    const longMelds = detected.melds.map((m) => {
      const meld = {
        ...m,
        isConcealed: false,
        position: "table",
        huPoints: 0
      };
      meld.huPoints = this.scoreCalculator.calculateMeldHuPoints(meld);
      return meld;
    });
    return {
      ...player,
      cards: detected.remaining,
      melds: [...player.melds, ...longMelds],
      hasEightBlocks: player.melds.filter((m) => m.type === "quadruple" /* QUADRUPLE */ || m.type === "draw_quadruple" /* DRAW_QUADRUPLE */).length + longMelds.length >= 2
    };
  }
  /**
   * 过张清理策略（默认 NEVER）：进入玩家新回合时清空该玩家过张记录
   */
  applyGuoZhangClearPolicy(state) {
    if (this.currentConfig.guoZhangClearPolicy === "NEVER") {
      return state;
    }
    if (this.currentConfig.guoZhangClearPolicy !== "ROUND_END") {
      return state;
    }
    if (state.phase !== "drawing" /* DRAWING */) {
      return state;
    }
    const idx = state.currentPlayerIndex;
    const players = [...state.players];
    if (players[idx].passedPlays.length === 0) {
      return state;
    }
    players[idx] = {
      ...players[idx],
      passedPlays: []
    };
    return {
      ...state,
      players
    };
  }
  sortCards(cards) {
    return [...cards].sort((a, b) => {
      if (a.size !== b.size) {
        return a.size === "big" ? 1 : -1;
      }
      if (a.value !== b.value) {
        return a.value - b.value;
      }
      return 0;
    });
  }
  markOrdinaryAction(state) {
    return {
      ...state,
      openingPhase: "normal",
      openingFacts: {
        ordinaryActionCount: (state.openingFacts?.ordinaryActionCount || 0) + 1
      }
    };
  }
  completeOpeningResolution(state) {
    if (state.openingPhase !== "dealer_pending_resolution") {
      return state;
    }
    return { ...state, openingPhase: "normal" };
  }
  prepareBaoSelection(players) {
    const preparedPlayers = players.map((player) => {
      const baoTingCards = this.rulesValidator.getBaoTingCards(player.cards, player.melds);
      return {
        ...player,
        isBao: false,
        baoTingCards
      };
    });
    const eligibleIndices = preparedPlayers.map((player, index) => ({ index, count: player.baoTingCards?.length || 0 })).filter((item) => item.count > 0).map((item) => item.index);
    return {
      players: preparedPlayers,
      eligibleIndices
    };
  }
  finalizeOpeningState(state) {
    const dealerIndex = state.players.findIndex((player) => player.isDealer);
    if (dealerIndex === -1) {
      return state;
    }
    const dealer = state.players[dealerIndex];
    const dealerPendingCard = state.dealerPendingCard;
    if (!dealer.isBao && dealerPendingCard) {
      const players2 = [...state.players];
      const dealerCards = dealer.cards.some((card) => card.id === dealerPendingCard.id) ? dealer.cards : [...dealer.cards, dealerPendingCard];
      players2[dealerIndex] = this.applyStartLong({
        ...dealer,
        cards: this.sortCards(dealerCards)
      });
      const nextState = {
        ...state,
        players: players2,
        currentPlayerIndex: dealerIndex,
        phase: "discarding" /* DISCARDING */,
        dealerPendingCard: void 0,
        baoEligiblePlayerIndices: void 0,
        baoDecisionIndex: void 0,
        pendingResponses: [],
        pendingCardSource: void 0,
        skipDiscardAfterZhao: false,
        openingPhase: "dealer_pending_resolution"
      };
      nextState.availableActions = this.turnManager.getAvailableActions(nextState);
      if (canDeclareHeavenlyWin(openingMingTangContext(nextState, dealerIndex)) && this.rulesValidator.checkHeavenlyWin(players2[dealerIndex].cards)) {
        return this.actionHandlers.handleHu(nextState, players2[dealerIndex].playerId, true);
      }
      return this.completeOpeningResolution(nextState);
    }
    const players = [...state.players];
    if (dealerPendingCard) {
      players[dealerIndex] = {
        ...dealer,
        cards: this.sortCards(dealer.cards.filter((card) => card.id !== dealerPendingCard.id))
      };
    }
    const responseState = {
      ...state,
      players,
      currentPlayerIndex: dealerIndex,
      phase: "response_collecting" /* RESPONSE_COLLECTING */,
      discardPile: {
        ...state.discardPile,
        lastDiscard: dealerPendingCard,
        lastDiscardPlayerIndex: dealerIndex
      },
      dealerPendingCard: void 0,
      baoEligiblePlayerIndices: void 0,
      baoDecisionIndex: void 0,
      pendingResponses: [],
      pendingCardSource: "draw",
      skipDiscardAfterZhao: false,
      openingPhase: "dealer_pending_resolution"
    };
    return this.openResponseWindow(responseState);
  }
  handleBaoChoice(state, declared) {
    if (state.phase === "discarding" /* DISCARDING */ && declared) {
      return state;
    }
    if (state.phase !== "bao_selection" /* BAO_SELECTION */) {
      return state;
    }
    const currentIndex = state.currentPlayerIndex;
    const currentPlayer = state.players[currentIndex];
    if (!currentPlayer || (currentPlayer.baoTingCards?.length || 0) === 0) {
      return state;
    }
    const players = [...state.players];
    players[currentIndex] = {
      ...currentPlayer,
      isBao: declared
    };
    const eligible = state.baoEligiblePlayerIndices || [];
    const nextDecisionIndex = (state.baoDecisionIndex || 0) + 1;
    const baoDecisions = [
      ...state.baoDecisions || [],
      {
        playerIndex: currentIndex,
        declared,
        tingCards: currentPlayer.baoTingCards || []
      }
    ];
    if (nextDecisionIndex < eligible.length) {
      const nextState = {
        ...state,
        players,
        currentPlayerIndex: eligible[nextDecisionIndex],
        baoDecisionIndex: nextDecisionIndex,
        baoDecisions
      };
      nextState.availableActions = this.turnManager.getAvailableActions(nextState);
      return nextState;
    }
    return this.finalizeOpeningState({
      ...state,
      players,
      baoDecisionIndex: nextDecisionIndex,
      baoDecisions
    });
  }
  handleDiscardToBao(state, playerId, discardCard) {
    if (state.phase !== "discarding" /* DISCARDING */) {
      return state;
    }
    const playerIndex = state.players.findIndex((player2) => player2.playerId === playerId);
    if (playerIndex === -1 || playerIndex !== state.currentPlayerIndex) {
      return state;
    }
    const player = state.players[playerIndex];
    if (!player.isDealer || player.isBao || player.cards.length < 21 || !discardCard) {
      return state;
    }
    const matchedCard = player.cards.find((card) => card.id === discardCard.id);
    if (!matchedCard) {
      return state;
    }
    const remainingCards = player.cards.filter((card) => card.id !== matchedCard.id);
    const tingCards = this.rulesValidator.getBaoTingCards(remainingCards, player.melds);
    if (tingCards.length === 0) {
      return state;
    }
    const players = [...state.players];
    players[playerIndex] = {
      ...player,
      cards: this.sortCards(remainingCards),
      isBao: true,
      baoTingCards: tingCards
    };
    const nextState = {
      ...state,
      players,
      currentPlayerIndex: playerIndex,
      phase: "response_collecting" /* RESPONSE_COLLECTING */,
      discardPile: {
        ...state.discardPile,
        lastDiscard: matchedCard,
        lastDiscardPlayerIndex: playerIndex
      },
      pendingResponses: [],
      pendingCardSource: "discard",
      skipDiscardAfterZhao: false
    };
    return this.openResponseWindow(nextState);
  }
  /**
   * 确定庄家索引
   * R8.4.1: 首局随机庄家（但如果未指定lastDealerIndex，默认为0以保持测试稳定）
   * R8.4.2: 胡牌者轮庄
   * R8.4.3: 流局庄家不变
   */
  determineDealerIndex(config) {
    if (config.lastGameDrawn && config.lastDealerIndex !== void 0) {
      return config.lastDealerIndex;
    }
    if (config.lastWinnerIndex !== void 0) {
      return config.lastWinnerIndex;
    }
    if (config.lastDealerIndex !== void 0) {
      return config.lastDealerIndex;
    }
    return 0;
  }
  /**
   * 创建新游戏
   */
  createGame(config = {}) {
    const finalConfig = { ...DEFAULT_GAME_CONFIG, ...config, playerCount: 3 };
    this.currentConfig = finalConfig;
    this.actionHandlers.setConfig(finalConfig);
    this.deck = Number.isFinite(finalConfig.seed) ? this.deckManager.createShuffledDeckWithSeed(finalConfig.seed) : this.deckManager.createShuffledDeck();
    const dealerIndex = this.determineDealerIndex(finalConfig);
    const dealResult = this.deckManager.deal(
      this.deck,
      finalConfig.playerCount,
      dealerIndex,
      finalConfig.bottomCardCount,
      true
    );
    this.deck = dealResult.remainingDeck;
    let players = dealResult.hands.map((hand, index) => ({
      playerId: `player_${index}`,
      playerName: `\u73A9\u5BB6${index}`,
      cards: hand,
      melds: [],
      isCurrentPlayer: index === dealResult.dealerIndex,
      isDealer: index === dealResult.dealerIndex,
      hasEightBlocks: false,
      passedPlays: [],
      chiHistory: [],
      totalScore: 0
    }));
    players = players.map((p) => this.applyStartLong(p));
    const baoPrepared = this.prepareBaoSelection(players);
    players = baoPrepared.players;
    const gameState = {
      players,
      currentPlayerIndex: baoPrepared.eligibleIndices[0] ?? dealResult.dealerIndex,
      discardPile: {
        cards: [],
        discardHistory: [],
        lastDiscard: void 0
      },
      tableMelds: [],
      phase: baoPrepared.eligibleIndices.length > 0 ? "bao_selection" /* BAO_SELECTION */ : "discarding" /* DISCARDING */,
      turnCount: 0,
      isGameOver: false,
      remainingDeckCards: dealResult.remainingDeck.length,
      availableActions: [],
      pendingResponses: [],
      pendingCardSource: void 0,
      skipDiscardAfterZhao: false,
      dealerPendingCard: dealResult.dealerPendingCard,
      baoEligiblePlayerIndices: baoPrepared.eligibleIndices,
      baoDecisionIndex: 0,
      baoDecisions: [],
      openingPhase: baoPrepared.eligibleIndices.length > 0 ? "bao_selection" : "dealer_pending_resolution",
      openingFacts: { ordinaryActionCount: 0 },
      drawOrdinal: 0,
      ruleVersion: finalConfig.ruleVersion,
      ruleProfile: this.snapshotRuleProfile(finalConfig)
    };
    if (baoPrepared.eligibleIndices.length === 0) {
      return this.finalizeOpeningState(gameState);
    }
    gameState.availableActions = this.turnManager.getAvailableActions(gameState);
    return gameState;
  }
  /**
   * 处理玩家行动
   */
  processAction(state, action) {
    if (state.isGameOver) {
      return state;
    }
    const normalizedAction = this.normalizeTimeoutAction(state, action);
    if (!normalizedAction) {
      return state;
    }
    action = normalizedAction;
    const currentAvailable = this.turnManager.getAvailableActions(state);
    const availableTypes = new Set(currentAvailable.map((a) => a.type));
    if (!availableTypes.has(action.type)) {
      return {
        ...state,
        availableActions: currentAvailable
      };
    }
    if (state.phase === "response_collecting" /* RESPONSE_COLLECTING */ && state.responseWindow) {
      const responseState = this.processWindowResponse(state, action, currentAvailable);
      if (responseState.isGameOver) return responseState;
      const checked = this.applyGuoZhangClearPolicy(responseState);
      const gameEndCheck2 = this.turnManager.checkGameEnd(checked);
      if (gameEndCheck2.ended || checked.turnCount > (this.currentConfig.maxTurns ?? 200)) {
        return { ...checked, phase: "ended" /* ENDED */, isGameOver: true };
      }
      return { ...checked, availableActions: this.turnManager.getAvailableActions(checked) };
    }
    let newState = state;
    switch (action.type) {
      case "draw":
        if (newState.phase === "drawing" /* DRAWING */ && newState.players[newState.currentPlayerIndex].cards.length < 21) {
          const drawResult = this.actionHandlers.handleDraw(newState, this.deck);
          newState = drawResult.drawnCard ? {
            ...drawResult.state,
            drawOrdinal: (drawResult.state.drawOrdinal || 0) + 1
          } : drawResult.state;
          newState = this.openResponseWindow(newState);
        }
        break;
      case "discard":
        if (action.cards?.length > 0) {
          const allowedDiscardIds = new Set(
            this.turnManager.getAvailableActions(newState).filter((a) => a.type === "discard" && a.cards.length > 0).map((a) => a.cards[0].id)
          );
          if (allowedDiscardIds.has(action.cards[0].id)) {
            newState = this.markOrdinaryAction(
              this.openResponseWindow(this.actionHandlers.handleDiscard(newState, action.cards[0]))
            );
          }
        }
        break;
      case "chi":
        if (action.cards?.length > 0) {
          newState = this.actionHandlers.handleChi(newState, action.playerId, action.cards, action.chiOptionId);
        }
        break;
      case "peng":
        newState = this.actionHandlers.handlePeng(newState, action.playerId);
        break;
      case "zhao":
        newState = this.actionHandlers.handleZhao(newState, action.playerId);
        break;
      case "hu":
        {
          const current = newState.players[newState.currentPlayerIndex];
          const huActiveCard = newState.phase === "response_collecting" /* RESPONSE_COLLECTING */ ? newState.discardPile.lastDiscard : void 0;
          const canClaimHu = !huActiveCard || canClaimActiveCard(
            newState,
            newState.currentPlayerIndex,
            huActiveCard,
            "hu"
          ).allowed;
          const canHuNow = canClaimHu && (this.rulesValidator.canHu(
            current.cards,
            current.melds,
            huActiveCard,
            newState.pendingCardSource
          ) || this.rulesValidator.getHuChiOptions(current.cards, current.melds, huActiveCard).length > 0);
          if (!canHuNow) {
            return {
              ...newState,
              availableActions: this.turnManager.getAvailableActions(newState)
            };
          }
        }
        newState = this.actionHandlers.handleHu(newState, action.playerId, false, action.huOptionId || action.chiOptionId);
        return newState;
      // 胡牌后游戏结束
      case "bao":
        newState = newState.phase === "discarding" /* DISCARDING */ ? this.handleDiscardToBao(newState, action.playerId, action.cards?.[0]) : this.handleBaoChoice(newState, true);
        break;
      case "pass_bao":
        newState = this.handleBaoChoice(newState, false);
        break;
      case "pass":
        {
          let playerIndex = -1;
          let passedActionType;
          let sourcePlayerIndex;
          {
            playerIndex = newState.players.findIndex((p) => p.playerId === action.playerId);
            const targetCard = newState.discardPile.lastDiscard;
            sourcePlayerIndex = newState.discardPile.lastDiscardPlayerIndex;
            if (newState.phase === "response_collecting" /* RESPONSE_COLLECTING */ && playerIndex >= 0 && targetCard) {
              const chiCheck = this.actionHandlers.canPlayerChi(newState, playerIndex, targetCard);
              if (chiCheck.canChi) {
                passedActionType = "chi";
              }
            }
            newState = this.actionHandlers.handlePass(newState, action.playerId, passedActionType);
          }
          if (newState.phase === "response_collecting" /* RESPONSE_COLLECTING */) {
            const prevPlayerIndex = getPreviousPlayerIndex(playerIndex, newState.players.length);
            const shouldKeepTurnForChiPass = passedActionType === "chi" && playerIndex >= 0 && sourcePlayerIndex === prevPlayerIndex;
            const shouldTransferSelfDrawChiPriority = passedActionType === "chi" && newState.pendingCardSource === "draw" && playerIndex >= 0 && sourcePlayerIndex === playerIndex;
            if (shouldKeepTurnForChiPass) {
              newState = {
                ...newState,
                currentPlayerIndex: playerIndex,
                turnCount: newState.turnCount + 1,
                phase: "drawing" /* DRAWING */,
                skipDiscardAfterZhao: false,
                pendingResponses: [],
                pendingCardSource: void 0
              };
            } else if (shouldTransferSelfDrawChiPriority) {
              const nextPlayerIndex = getNextPlayerIndex(playerIndex, newState.players.length);
              newState = {
                ...newState,
                currentPlayerIndex: nextPlayerIndex,
                pendingResponses: []
              };
            } else {
              newState = this.materializePendingDrawCard(newState);
              newState = this.turnManager.endTurn({
                ...newState,
                pendingCardSource: void 0
              });
            }
          } else if (newState.phase === "discarding" /* DISCARDING */) {
            newState = this.turnManager.endTurn(newState);
          }
        }
        break;
    }
    newState = this.applyGuoZhangClearPolicy(newState);
    const gameEndCheck = this.turnManager.checkGameEnd(newState);
    const maxTurns = this.currentConfig.maxTurns ?? 200;
    if (gameEndCheck.ended || newState.turnCount > maxTurns) {
      return {
        ...newState,
        phase: "ended" /* ENDED */,
        isGameOver: true
      };
    }
    newState.availableActions = this.turnManager.getAvailableActions(newState);
    return newState;
  }
  /**
   * 结束游戏并准备下一局配置
   * R8.4.2: 胡牌者轮庄
   * R8.4.3: 流局庄家不变
   */
  endGame(state) {
    const isDrawn = state.winnerIndex === void 0;
    const dealerIndex = state.players.findIndex((p) => p.isDealer);
    return {
      ...this.currentConfig,
      lastDealerIndex: dealerIndex,
      lastGameDrawn: isDrawn,
      lastWinnerIndex: state.winnerIndex
    };
  }
  /**
   * 获取当前玩家
   */
  getCurrentPlayer(state) {
    return state.players[state.currentPlayerIndex];
  }
  /**
   * 移动到下一个回合
   */
  nextTurn(state) {
    return this.turnManager.endTurn(state);
  }
  /**
   * 开始新回合
   */
  startTurn(state) {
    return this.turnManager.startTurn(state);
  }
  /**
   * 检查游戏是否结束
   */
  checkGameEnd(state) {
    return this.turnManager.checkGameEnd(state);
  }
  /**
   * 获取可用操作
   */
  getAvailableActions(state) {
    const availableActions = this.turnManager.getAvailableActions(state);
    const actingPlayerIndex2 = this.getActingPlayerIndex(state);
    return availableActions.map((action) => ({
      type: action.type,
      playerId: state.players[actingPlayerIndex2].playerId,
      cards: action.cards,
      chiOptionId: action.chiOptions?.[0]?.id,
      huOptionId: action.huOptions?.[0]?.id,
      timestamp: Date.now()
    }));
  }
  /**
   * 更新游戏状态的可用操作（返回 AvailableAction[]）
   */
  updateAvailableActions(state) {
    const availableActions = this.turnManager.getAvailableActions(state);
    return {
      ...state,
      availableActions
    };
  }
  /**
   * 验证游戏状态
   */
  validateState(state) {
    return this.rulesValidator.validateGameState(state);
  }
  /**
   * 获取牌堆剩余数量
   */
  getDeckRemaining() {
    return this.deckManager.remainingCount(this.deck);
  }
  /**
   * 重置游戏（使用相同配置重新开始）
   */
  resetGame(state) {
    const config = {
      ...this.currentConfig,
      playerCount: 3
    };
    return this.createGame(config);
  }
  /**
   * 开始下一局游戏（使用轮庄规则）
   */
  startNextGame(previousState) {
    const nextConfig = this.endGame(previousState);
    return this.createGame(nextConfig);
  }
};
var gameManager = new GameManager();

// src/ai/opponent-inference.ts
var OpponentInference = class {
  /**
   * 推断对手手牌
   */
  inferOpponentHands(playerId, knownCards, discardedCards, _tableMelds) {
    const fullDeck = CardFactory.createDeck();
    const possibleCards = fullDeck.filter((card) => {
      if (knownCards.has(card.id)) return false;
      if (discardedCards.some(
        (d) => d.rank === card.rank && d.size === card.size
      )) {
        const discardedCount = discardedCards.filter(
          (d) => d.rank === card.rank && d.size === card.size
        ).length;
        if (discardedCount >= 4) return false;
      }
      return true;
    });
    const cardProbabilities = /* @__PURE__ */ new Map();
    const totalUnknown = 80 - knownCards.size - discardedCards.length;
    for (const card of possibleCards) {
      const key = `${card.rank}_${card.size}`;
      const currentCount = discardedCards.filter(
        (d) => d.rank === card.rank && d.size === card.size
      ).length;
      const remainingCount = 4 - currentCount;
      const probability = remainingCount / totalUnknown;
      cardProbabilities.set(key, probability);
    }
    const possibleMelds = [];
    const confidence = this.calculateConfidence(knownCards.size, discardedCards.length);
    const reasoning = this.generateReasoning(knownCards.size, discardedCards.length, possibleCards.length);
    return {
      playerId,
      possibleCards,
      possibleMelds,
      confidence,
      reasoning,
      keyCards: this.identifyKeyCards(possibleCards)
    };
  }
  calculateConfidence(knownCount, discardedCount) {
    const infoRatio = (knownCount + discardedCount) / 80;
    return Math.min(1, infoRatio * 1.5);
  }
  generateReasoning(knownCount, discardedCount, possibleCount) {
    const infoPercent = Math.round((knownCount + discardedCount) / 80 * 100);
    return `\u57FA\u4E8E ${infoPercent}% \u7684\u5DF2\u77E5\u4FE1\u606F\u63A8\u65AD\uFF0C\u8FD8\u5269 ${possibleCount} \u5F20\u53EF\u80FD\u724C`;
  }
  identifyKeyCards(possibleCards) {
    const keyCards = [];
    const redCards = possibleCards.filter((c) => c.isRed);
    keyCards.push(...redCards.slice(0, 3));
    return keyCards;
  }
  inferTingProbability(playerId, opponentMelds, discardedCards) {
    let probability = 0;
    const meldCount = opponentMelds.reduce(
      (sum, m) => sum + (m.type !== "pair" ? 1 : 0),
      0
    );
    probability += meldCount * 0.1;
    const playCount = discardedCards.length;
    probability += playCount * 0.02;
    return Math.min(1, probability);
  }
};

// src/ai/win-rate-calculator.ts
var WinRateCalculator = class {
  constructor() {
    this.meldDetector = new MeldDetector();
    this.scoreCalculator = new ScoreCalculator();
    this.rulesValidator = new RulesValidator();
  }
  /**
   * 计算当前胜率
   */
  calculateWinRate(handCards, melds, knownCards, simulationCount = 1e3) {
    const potentialWinRates = /* @__PURE__ */ new Map();
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
      calculationMethod: "monte_carlo",
      simulationCount
    };
  }
  getPossibleDraws(knownCards) {
    const fullDeck = CardFactory.createDeck();
    return fullDeck.filter((card) => !knownCards.has(card.id));
  }
  simulateDraw(handCards, melds, drawCard, _knownCards) {
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
  calculateHeuristicWinRate(handCards, melds) {
    const potentialMelds = this.meldDetector.detectAllMelds(handCards);
    const scoreSnapshot = this.scoreCalculator.calculateTotalScore([...melds, ...potentialMelds]);
    const pairCount = this.meldDetector.detectPairs(handCards).melds.length;
    const tripleCount = this.meldDetector.detectTriples(handCards).melds.length;
    const sequenceCount = this.meldDetector.detectSequences(handCards).melds.length;
    const specialCount = this.meldDetector.detectSpecial2710(handCards).melds.length;
    const usedCards = potentialMelds.reduce((sum, meld) => sum + meld.cards.length, 0);
    const looseCards = Math.max(0, handCards.length - usedCards);
    const redCards = handCards.filter((c) => c.isRed).length;
    let winRate = 0.08;
    winRate += melds.length * 0.09;
    winRate += potentialMelds.filter((meld) => meld.type !== "pair").length * 0.05;
    winRate += pairCount * 0.025;
    winRate += tripleCount * 0.05;
    winRate += sequenceCount * 0.03;
    winRate += specialCount * 0.03;
    winRate += Math.min(0.18, scoreSnapshot.totalHuPoints * 0.01);
    winRate += Math.min(0.12, scoreSnapshot.roundScore * 0.012);
    winRate += redCards * 8e-3;
    winRate -= looseCards * 0.022;
    if (this.rulesValidator.canHu(handCards, melds)) {
      winRate = Math.max(winRate, 0.96);
    }
    return {
      currentWinRate: Math.max(0, Math.min(1, winRate)),
      potentialWinRates: /* @__PURE__ */ new Map(),
      averageWinRate: Math.max(0, Math.min(1, winRate)),
      calculationMethod: "heuristic"
    };
  }
  calculateDiscardWinRates(handCards, melds, _knownCards) {
    const winRates = /* @__PURE__ */ new Map();
    for (const card of handCards) {
      const remainingCards = handCards.filter((c) => c.id !== card.id);
      const result = this.calculateHeuristicWinRate(remainingCards, melds);
      winRates.set(card.id, result.currentWinRate);
    }
    return winRates;
  }
};

// src/game-engine/hand-analyzer.ts
var HandAnalyzer = class {
  constructor() {
    this.meldDetector = new MeldDetector();
    this.scoreCalculator = new ScoreCalculator();
    this.rulesValidator = new RulesValidator();
    this.potentialMeldMemo = /* @__PURE__ */ new Map();
  }
  /**
   * 分析手牌
   */
  analyze(handCards, knownMelds = []) {
    const melds = [...knownMelds];
    const potentialMelds = this.selectBestPotentialMelds(handCards);
    const lockedCardIds = /* @__PURE__ */ new Set();
    const lockedCountsByCode = {};
    const addLockedCard = (card) => {
      lockedCardIds.add(card.id);
      const code = `${card.size}_${card.value}`;
      lockedCountsByCode[code] = (lockedCountsByCode[code] || 0) + 1;
    };
    for (const meld of melds) {
      for (const card of meld.cards) {
        addLockedCard(card);
      }
    }
    const groupedByCode = /* @__PURE__ */ new Map();
    for (const card of handCards) {
      const code = `${card.size}_${card.value}`;
      if (!groupedByCode.has(code)) {
        groupedByCode.set(code, []);
      }
      groupedByCode.get(code).push(card);
    }
    for (const group of groupedByCode.values()) {
      if (group.length < 3) {
        continue;
      }
      for (const card of group) {
        addLockedCard(card);
      }
    }
    const usedCardIds = /* @__PURE__ */ new Set();
    melds.forEach((m) => m.cards.forEach((c) => usedCardIds.add(c.id)));
    potentialMelds.forEach((m) => m.cards.forEach((c) => usedCardIds.add(c.id)));
    const looseCards = handCards.filter((c) => !usedCardIds.has(c.id));
    const tingCards = this.rulesValidator.getBaoTingCards(handCards, melds);
    const scoreResult = this.scoreCalculator.calculateTotalScore([...melds, ...potentialMelds]);
    const canWin = this.rulesValidator.canHu(handCards, knownMelds);
    const completeness = handCards.length === 0 ? 1 : Math.max(0, Math.min(1, 1 - looseCards.length / handCards.length));
    const stepsToWin = canWin ? 0 : tingCards.length > 0 ? 1 : Math.max(1, Math.ceil(Math.max(1, looseCards.length) / 3));
    return {
      melds,
      potentialMelds,
      looseCards,
      tingCards,
      tingPositions: [],
      lockedCardIds: Array.from(lockedCardIds),
      lockedCountsByCode,
      canWin,
      totalHuPoints: scoreResult.totalHuPoints,
      completeness,
      stepsToWin
    };
  }
  selectBestPotentialMelds(cards) {
    const rootCounts = this.buildRootCountMap(cards);
    const rootSignature = this.buildRootCountSignature(rootCounts);
    return this.solveBestPotentialMelds(cards, rootCounts, rootSignature);
  }
  solveBestPotentialMelds(cards, rootCounts, rootSignature) {
    const signature = `${rootSignature}__${this.buildExactCardSignature(cards)}`;
    const cached = this.potentialMeldMemo.get(signature);
    if (cached) {
      return cached;
    }
    const candidates = this.listCandidateMelds(cards);
    if (candidates.length === 0) {
      this.storePotentialMeldMemo(signature, []);
      return [];
    }
    let best = [];
    let bestScore = Number.NEGATIVE_INFINITY;
    for (const candidate of candidates) {
      const usedIds = new Set(candidate.cards.map((card) => card.id));
      const remaining = cards.filter((card) => !usedIds.has(card.id));
      const next = this.solveBestPotentialMelds(remaining, rootCounts, rootSignature);
      const combo = [candidate, ...next];
      const score = this.scorePotentialCombo(combo, rootCounts);
      if (score > bestScore) {
        bestScore = score;
        best = combo;
      }
    }
    this.storePotentialMeldMemo(signature, best);
    return best;
  }
  storePotentialMeldMemo(key, melds) {
    if (this.potentialMeldMemo.size >= 4e3) {
      this.potentialMeldMemo.clear();
    }
    this.potentialMeldMemo.set(key, melds);
  }
  buildCardSignature(cards) {
    const counts = /* @__PURE__ */ new Map();
    for (const card of cards) {
      const key = `${card.size}_${card.value}`;
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    return Array.from(counts.entries()).sort(([left], [right]) => left.localeCompare(right)).map(([key, count]) => `${key}:${count}`).join("|");
  }
  buildExactCardSignature(cards) {
    return cards.map((card) => String(card.id)).sort().join("|");
  }
  buildRootCountMap(cards) {
    const counts = /* @__PURE__ */ new Map();
    for (const card of cards) {
      const key = `${card.size}_${card.value}`;
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    return counts;
  }
  buildRootCountSignature(rootCounts) {
    return Array.from(rootCounts.entries()).sort(([left], [right]) => left.localeCompare(right)).map(([key, count]) => `${key}:${count}`).join("|");
  }
  scorePotentialCombo(melds, rootCounts) {
    const weightByType = {
      quadruple: 4.8,
      triple: 4.2,
      special_2710: 4,
      mixed_size: 3.6,
      sequence: 3,
      pair: 0.2
    };
    const coveredCards = melds.reduce((sum, meld) => sum + meld.cards.length, 0);
    const nonPairs = melds.filter((meld) => meld.type !== "pair").length;
    const buriedTriplePenalty = melds.reduce((sum, meld) => {
      if (meld.type !== "pair") {
        return sum;
      }
      const anchor = meld.cards[0];
      if (!anchor) {
        return sum;
      }
      const key = `${anchor.size}_${anchor.value}`;
      return sum + ((rootCounts.get(key) || 0) >= 3 ? 1.4 : 0);
    }, 0);
    return melds.reduce((sum, meld) => sum + (weightByType[meld.type] || 0), 0) + coveredCards * 0.18 + nonPairs * 0.35 - buriedTriplePenalty;
  }
  listCandidateMelds(cards) {
    const candidates = [];
    const byCode = /* @__PURE__ */ new Map();
    const bySizeValue = /* @__PURE__ */ new Map();
    for (const card of cards) {
      const code = `${card.size}_${card.value}`;
      if (!byCode.has(code)) {
        byCode.set(code, []);
      }
      byCode.get(code).push(card);
      if (!bySizeValue.has(code)) {
        bySizeValue.set(code, []);
      }
      bySizeValue.get(code).push(card);
    }
    for (const group of byCode.values()) {
      if (group.length >= 4) {
        candidates.push({
          type: "quadruple",
          cards: group.slice(0, 4),
          isConcealed: true,
          position: "hand",
          huPoints: 0
        });
      }
      if (group.length >= 3) {
        candidates.push({
          type: "triple",
          cards: group.slice(0, 3),
          isConcealed: true,
          position: "hand",
          huPoints: 0
        });
      }
      if (group.length >= 2) {
        candidates.push({
          type: "pair",
          cards: group.slice(0, 2),
          isConcealed: true,
          position: "hand",
          huPoints: 0
        });
      }
    }
    for (const size of ["small", "big"]) {
      for (let start = 1; start <= 8; start++) {
        const first = bySizeValue.get(`${size}_${start}`)?.[0];
        const second = bySizeValue.get(`${size}_${start + 1}`)?.[0];
        const third = bySizeValue.get(`${size}_${start + 2}`)?.[0];
        if (first && second && third) {
          candidates.push({
            type: "sequence",
            cards: [first, second, third],
            isConcealed: true,
            position: "hand",
            huPoints: 0
          });
        }
      }
      const two = bySizeValue.get(`${size}_2`)?.[0];
      const seven = bySizeValue.get(`${size}_7`)?.[0];
      const ten = bySizeValue.get(`${size}_10`)?.[0];
      if (two && seven && ten) {
        candidates.push({
          type: "special_2710",
          cards: [two, seven, ten],
          isConcealed: true,
          position: "hand",
          huPoints: 0
        });
      }
    }
    for (let value = 1; value <= 10; value++) {
      const smallCards = bySizeValue.get(`small_${value}`) || [];
      const bigCards = bySizeValue.get(`big_${value}`) || [];
      if (bigCards.length >= 2 && smallCards.length >= 1) {
        candidates.push({
          type: "mixed_size",
          cards: [bigCards[0], bigCards[1], smallCards[0]],
          isConcealed: true,
          position: "hand",
          huPoints: 0
        });
      }
      if (smallCards.length >= 2 && bigCards.length >= 1) {
        candidates.push({
          type: "mixed_size",
          cards: [smallCards[0], smallCards[1], bigCards[0]],
          isConcealed: true,
          position: "hand",
          huPoints: 0
        });
      }
    }
    return candidates;
  }
  /**
   * 计算手牌强度
   */
  calculateStrength(handCards, melds) {
    let strength = 0;
    for (const meld of melds) {
      strength += this.scoreCalculator.calculateMeldValue(meld);
    }
    const analysis = this.analyze(handCards, melds);
    for (const potential of analysis.potentialMelds) {
      const meldWeight = potential.type === "pair" ? 0.35 : 0.65;
      strength += this.scoreCalculator.calculateMeldValue(potential) * meldWeight;
    }
    if (analysis.tingCards.length > 0) {
      strength += analysis.tingCards.length * 2;
    }
    strength += (analysis.totalHuPoints || 0) * 0.8;
    strength += (analysis.completeness || 0) * 18;
    strength -= analysis.looseCards.length * 1.5;
    return Math.min(100, strength);
  }
  /**
   * 计算改善潜力
   */
  calculateImprovementPotential(handCards, melds) {
    let potential = 0;
    const analysis = this.analyze(handCards, melds);
    potential += analysis.potentialMelds.length * 5;
    potential += analysis.tingCards.length * 3;
    potential -= analysis.looseCards.length * 2;
    return Math.max(0, Math.min(100, potential));
  }
  /**
   * 查找最佳出牌
   */
  findBestDiscard(handCards, melds) {
    if (handCards.length === 0) return null;
    let bestCard = handCards[0];
    let bestScore = -Infinity;
    for (const card of handCards) {
      const remainingCards = handCards.filter((c) => c.id !== card.id);
      const analysis = this.analyze(remainingCards, melds);
      const sameRankCount = handCards.filter((c) => c.rank === card.rank && c.size === card.size).length;
      let score = 0;
      score += analysis.potentialMelds.filter((meld) => meld.type !== "pair").length * 6;
      score += analysis.tingCards.length * 8;
      score += (analysis.totalHuPoints || 0) * 1.4;
      score -= analysis.looseCards.length * 2.5;
      score += (analysis.completeness || 0) * 14;
      score -= (analysis.stepsToWin || 0) * 2.5;
      if (sameRankCount >= 2) {
        score -= 3;
      }
      if (card.isRed) {
        score -= 2.5;
      }
      if (score > bestScore) {
        bestScore = score;
        bestCard = card;
      }
    }
    return { card: bestCard, score: bestScore };
  }
};

// src/ai/strategy-evaluator.ts
var StrategyEvaluator = class {
  constructor() {
    this.handAnalyzer = new HandAnalyzer();
    this.scoreCalculator = new ScoreCalculator();
    this.winRateCalculator = new WinRateCalculator();
  }
  /**
   * 评估当前手牌策略
   */
  evaluate(handCards, melds, discardedCards) {
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
  evaluatePosition(handCards, melds, discardedCards, analysis, totalHuPoints, estimatedWinRate) {
    let score = 40;
    score += Math.min(30, totalHuPoints * 3.5);
    score += Math.min(18, analysis.tingCards.length * 2.5);
    score += (analysis.completeness || 0) * 18;
    score += estimatedWinRate * 16;
    const redCards = handCards.filter((card) => card.isRed).length;
    score += Math.min(8, redCards * 1.8);
    const meldCount = melds.filter((meld) => meld.type !== "pair").length;
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
  identifyKeyFactors(handCards, melds, discardedCards, analysis, totalHuPoints, estimatedWinRate, roundScore, totalFans) {
    const factors = [];
    const redCount = handCards.filter((card) => card.isRed).length;
    const meldCount = melds.filter((meld) => meld.type !== "pair").length;
    const scoringPressure = Math.min(1, (totalHuPoints * 0.5 + roundScore * 0.8 + totalFans * 2) / 24);
    const attackPressure = analysis.canWin ? 1 : Math.max(0, 1 - ((analysis.stepsToWin || 4) - 1) / 4);
    const defensePressure = Math.min(1, (analysis.looseCards.length || 0) / Math.max(1, handCards.length) + (discardedCards.length > 10 ? 0.15 : 0));
    const flexibility = Math.min(1, (analysis.potentialMelds.length - analysis.looseCards.length * 0.35 + analysis.tingCards.length) / Math.max(3, handCards.length * 0.55));
    factors.push({
      name: "\u6210\u724C\u901F\u5EA6",
      value: attackPressure,
      weight: 0.24,
      description: analysis.canWin ? "\u5DF2\u7ECF\u6210\u80E1\uFF0C\u8282\u594F\u5904\u4E8E\u6700\u5F3A\u8FDB\u653B\u72B6\u6001" : analysis.tingCards.length > 0 ? `\u5DF2\u7ECF\u6709\u542C\u53E3\uFF0C\u79BB\u6210\u80E1\u53EA\u5DEE\u4E34\u95E8\u4E00\u811A` : `\u8DDD\u79BB\u542C\u724C\u7EA6\u8FD8\u6709 ${analysis.stepsToWin || "?"} \u6B65`
    });
    factors.push({
      name: "\u8BA1\u5206\u6F5C\u529B",
      value: scoringPressure,
      weight: 0.24,
      description: totalHuPoints > 0 ? `\u5F53\u524D\u6210\u578B\u90E8\u5206\u7EA6\u6709 ${totalHuPoints} \u80E1\u3001\u5355\u5C40\u6F5C\u529B\u7EA6 ${roundScore} \u5206\uFF0C\u7EE7\u7EED\u505A\u5927\u6709\u4EF7\u503C` : "\u5F53\u524D\u80E1\u606F\u504F\u4F4E\uFF0C\u66F4\u8981\u517C\u987E\u6210\u724C\u6548\u7387\u548C\u540D\u5802\u7A7A\u95F4"
    });
    factors.push({
      name: "\u624B\u724C\u6574\u9F50\u5EA6",
      value: analysis.completeness || 0,
      weight: 0.2,
      description: `\u53EF\u8054\u52A8\u724C\u5360\u6BD4\u7EA6 ${Math.round((analysis.completeness || 0) * 100)}%`
    });
    factors.push({
      name: "\u7EA2\u724C\u4E0E\u540D\u5802\u7A7A\u95F4",
      value: handCards.length === 0 ? 0 : redCount / handCards.length,
      weight: 0.14,
      description: redCount > 0 ? `\u624B\u91CC\u6709 ${redCount} \u5F20\u7EA2\u724C\uFF0C\u4ECD\u6709\u7EE7\u7EED\u505A\u7EA2\u6216\u4FDD\u7559\u756A\u6570\u7A7A\u95F4` : "\u5F53\u524D\u6CA1\u6709\u7EA2\u724C\uFF0C\u540E\u7EED\u66F4\u504F\u5411\u9ED1\u724C\u8DEF\u7EBF\u6216\u7EAF\u901F\u5EA6\u8DEF\u7EBF"
    });
    factors.push({
      name: "\u8DEF\u7EBF\u7075\u6D3B\u5EA6",
      value: flexibility,
      weight: 0.16,
      description: flexibility > 0.6 ? "\u8FD9\u624B\u724C\u5206\u8DEF\u8F83\u591A\uFF0C\u53EF\u4EE5\u8FB9\u6574\u7406\u8FB9\u9009\u62E9\u5FEB\u80E1\u6216\u505A\u5927" : "\u5F53\u524D\u8DEF\u7EBF\u6BD4\u8F83\u5355\u4E00\uFF0C\u4E00\u65E6\u62C6\u9519\u4E3B\u5E72\uFF0C\u540E\u7EED\u56DE\u65CB\u7A7A\u95F4\u4F1A\u660E\u663E\u4E0B\u964D"
    });
    factors.push({
      name: "\u9632\u5B88\u538B\u529B",
      value: 1 - defensePressure,
      weight: 0.18,
      description: defensePressure > 0.65 ? "\u6563\u5F20\u504F\u591A\uFF0C\u82E5\u5F3A\u884C\u505A\u724C\uFF0C\u540E\u9762\u5BB9\u6613\u6253\u51FA\u751F\u5F20" : meldCount >= 3 ? "\u73B0\u6709\u724C\u7EC4\u8F83\u7A33\uFF0C\u9632\u5B88\u538B\u529B\u76F8\u5BF9\u53EF\u63A7" : "\u724C\u578B\u8FD8\u5728\u6574\u7406\u9636\u6BB5\uFF0C\u9700\u8981\u7559\u610F\u8282\u594F\u4E0E\u5931\u8BEF\u6210\u672C"
    });
    factors.push({
      name: "\u5373\u65F6\u80DC\u7387",
      value: estimatedWinRate,
      weight: 0.12,
      description: `\u6309\u5F53\u524D\u7ED3\u6784\u4F30\u8BA1\uFF0C\u540E\u7EED\u6210\u80E1\u628A\u63E1\u7EA6 ${(estimatedWinRate * 100).toFixed(0)}%`
    });
    return factors;
  }
  /**
   * 评估风险
   */
  assessRisk(handCards, melds, discardedCards, analysis) {
    let risk = 36;
    const looseRatio = (analysis.looseCards.length || 0) / Math.max(1, handCards.length);
    const redCards = handCards.filter((card) => card.isRed).length;
    const meldCount = melds.filter((meld) => meld.type !== "pair").length;
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
  calculateOverallScore(factors) {
    let totalWeight = 0;
    let weightedSum = 0;
    for (const factor of factors) {
      weightedSum += (factor.value || 0) * factor.weight;
      totalWeight += factor.weight;
    }
    return totalWeight > 0 ? weightedSum / totalWeight * 100 : 50;
  }
  /**
   * 生成策略建议
   */
  generateSuggestions(handStrength, factors, riskLevel, stepsToWin, totalHuPoints, roundScore) {
    const suggestions = [];
    const speedFactor = factors.find((factor) => factor.name === "\u6210\u724C\u901F\u5EA6");
    const scoreFactor = factors.find((factor) => factor.name === "\u8BA1\u5206\u6F5C\u529B");
    const defenseFactor = factors.find((factor) => factor.name === "\u9632\u5B88\u538B\u529B");
    const flexibilityFactor = factors.find((factor) => factor.name === "\u8DEF\u7EBF\u7075\u6D3B\u5EA6");
    if (stepsToWin <= 1 || (speedFactor?.value || 0) > 0.72) {
      suggestions.push("\u73B0\u5728\u66F4\u9002\u5408\u4E3B\u52A8\u62A2\u8282\u594F\uFF0C\u4F18\u5148\u4FDD\u7559\u80FD\u76F4\u63A5\u542C\u724C\u6216\u505A\u5927\u724C\u7684\u8854\u63A5");
    } else if (riskLevel >= 68 || (defenseFactor?.value || 0) < 0.35) {
      suggestions.push("\u5F53\u524D\u66F4\u50CF\u9632\u5B88\u56DE\u5408\uFF0C\u5148\u5904\u7406\u5B64\u5F20\u548C\u5371\u9669\u751F\u5F20\uFF0C\u964D\u4F4E\u653E\u70AE\u6982\u7387");
    } else if ((scoreFactor?.value || 0) > 0.55 || totalHuPoints >= 10 || roundScore >= 8) {
      suggestions.push("\u8FD9\u624B\u724C\u5DF2\u7ECF\u6709\u4E00\u5B9A\u8BA1\u5206\u57FA\u7840\uFF0C\u4E0D\u5FC5\u53EA\u6C42\u5FEB\u80E1\uFF0C\u4E5F\u8981\u517C\u987E\u756A\u6570\u548C\u6210\u578B\u8D28\u91CF");
    } else {
      suggestions.push("\u8FD9\u624B\u724C\u5904\u4E8E\u4E2D\u6BB5\u6574\u7406\u671F\uFF0C\u5148\u628A\u7ED3\u6784\u7406\u987A\uFF0C\u518D\u51B3\u5B9A\u8981\u4E0D\u8981\u5F3A\u653B");
    }
    if ((flexibilityFactor?.value || 0) > 0.58) {
      suggestions.push("\u5F53\u524D\u4ECD\u6709\u591A\u6761\u6210\u578B\u8DEF\u7EBF\uFF0C\u51FA\u724C\u65F6\u4F18\u5148\u4FDD\u7559\u80FD\u540C\u65F6\u517C\u987E\u987A\u5B50\u3001\u5BF9\u5B50\u548C\u5927\u5C0F\u642D\u7684\u6838\u5FC3\u5F20");
    }
    if (handStrength === "very_strong" /* VERY_STRONG */ || handStrength === "strong" /* STRONG */) {
      suggestions.push("\u724C\u529B\u504F\u5F3A\uFF0C\u4F18\u5148\u4FDD\u7559\u6838\u5FC3\u642D\u5B50\uFF0C\u4E0D\u8981\u4E3A\u4E86\u773C\u524D\u5C0F\u5229\u62C6\u6389\u4E3B\u5E72");
    } else if (handStrength === "weak" /* WEAK */ || handStrength === "very_weak" /* VERY_WEAK */) {
      suggestions.push("\u724C\u529B\u504F\u5F31\uFF0C\u5148\u6253\u4F4E\u6548\u7387\u724C\uFF0C\u5C3D\u91CF\u5C11\u628A\u5173\u952E\u7EA2\u724C\u548C\u642D\u5B50\u4E00\u8D77\u9001\u6389");
    }
    if (riskLevel > 70) {
      suggestions.push("\u98CE\u9669\u5DF2\u7ECF\u504F\u9AD8\uFF0C\u82E5\u6CA1\u6709\u660E\u663E\u589E\u76CA\uFF0C\u5B81\u53EF\u6162\u4E00\u70B9\uFF0C\u4E5F\u4E0D\u8981\u8F7B\u6613\u6253\u751F\u5F20\u8BD5\u63A2");
    }
    return suggestions;
  }
  /**
   * 获取手牌强度等级
   */
  getHandStrengthLevel(handCards, melds) {
    const strength = this.handAnalyzer.calculateStrength(handCards, melds);
    if (strength >= 80) return "very_strong" /* VERY_STRONG */;
    if (strength >= 60) return "strong" /* STRONG */;
    if (strength >= 40) return "average" /* MEDIUM */;
    if (strength >= 20) return "weak" /* WEAK */;
    return "very_weak" /* VERY_WEAK */;
  }
};

// src/ai/explanation-engine.ts
var AIExplanationEngine = class {
  constructor() {
    this.tagLabels = {
      speed: "\u63D0\u901F",
      ukeire: "\u8FDB\u5F20",
      score: "\u51B2\u5206",
      risk: "\u907F\u9669",
      shape: "\u724C\u6548",
      timing: "\u65F6\u673A",
      flexibility: "\u5F39\u6027"
    };
  }
  buildExplanation(input) {
    const summary = input.fallbackSummary || this.buildSummary(input.action, input.posture, input.evidence);
    const keyPoints = this.mergePoints(input.evidence, input.fallbackPoints || []);
    return {
      summary,
      keyPoints: keyPoints.slice(0, 4)
    };
  }
  buildSummary(action, posture, evidence) {
    if (action === "discard") {
      if (posture === "attack") return "\u8FD9\u5F20\u662F\u5F53\u524D\u6700\u9002\u5408\u7684\u63D0\u901F\u820D\u5F20";
      if (posture === "defense") return "\u8FD9\u5F20\u662F\u5F53\u524D\u66F4\u9002\u5408\u5148\u5904\u7406\u7684\u98CE\u9669\u724C";
      return "\u8FD9\u5F20\u6700\u4E0D\u4F24\u4E3B\u5E72\uFF0C\u9002\u5408\u5F53\u524D\u6574\u7406\u8282\u594F";
    }
    if (action === "hu") return "\u6536\u76CA\u5DF2\u7ECF\u6210\u719F\uFF0C\u5148\u628A\u786E\u5B9A\u5206\u6570\u6536\u4E0B";
    if (action === "pass") return "\u5148\u8FC7\u4E0D\u662F\u653E\u5F03\uFF0C\u800C\u662F\u5728\u4FDD\u7559\u540E\u7EED\u8DEF\u7EBF";
    if ((evidence?.tempoGain || 0) > 0.5) {
      return "\u8FD9\u6B65\u80FD\u660E\u663E\u6539\u5584\u8282\u594F\uFF0C\u5C5E\u4E8E\u4E3B\u52A8\u63D0\u901F\u7684\u64CD\u4F5C";
    }
    if ((evidence?.scorePotential || 0) >= 10) {
      return "\u8FD9\u6B65\u66F4\u504F\u5411\u7ACB\u5206\u548C\u51B2\u6863\uFF0C\u6536\u76CA\u6BD4\u8F83\u76F4\u63A5";
    }
    if ((evidence?.dangerScore || 0) >= 60) {
      return "\u8FD9\u6B65\u8981\u517C\u987E\u5B89\u5168\uFF0C\u4E0D\u80FD\u53EA\u770B\u773C\u524D\u80FD\u4E0D\u80FD\u6210\u4E00\u7EC4";
    }
    return "\u8FD9\u6B65\u4E3B\u8981\u662F\u5728\u6574\u7406\u7ED3\u6784\uFF0C\u4E89\u53D6\u628A\u540E\u7EED\u8DEF\u7EBF\u505A\u987A";
  }
  mergePoints(evidence, fallbackPoints = []) {
    const points = [];
    for (const signal of evidence?.signals || []) {
      if (signal && !points.includes(signal)) {
        points.push(signal);
      }
    }
    const tags = evidence?.tags || [];
    if (tags.length > 0) {
      const tagLine = `\u6559\u5B66\u91CD\u70B9\uFF1A${tags.map((tag) => this.tagLabels[tag]).join("\u3001")}`;
      if (!points.includes(tagLine)) {
        points.push(tagLine);
      }
    }
    for (const point of fallbackPoints) {
      if (point && !points.includes(point)) {
        points.push(point);
      }
    }
    return points;
  }
};

// src/ai/action-ev-evaluator.ts
var ActionEvEvaluator = class {
  evaluate(params) {
    const beforeSteps = params.beforeSteps ?? 3;
    const afterSteps = params.afterSteps ?? beforeSteps;
    const beforeUkeire = params.beforeUkeire ?? 0;
    const afterUkeire = params.afterUkeire ?? beforeUkeire;
    const beforeScorePotential = params.beforeScorePotential ?? 0;
    const afterScorePotential = params.afterScorePotential ?? beforeScorePotential;
    const dangerScore = Math.max(0, params.dangerScore ?? 0);
    const emergencyDefense = this.shouldEmergencyDefend(params.gameState, params.playerIndex, beforeSteps);
    const shantenDelta = beforeSteps - afterSteps;
    const shantenReward = shantenDelta > 0 ? shantenDelta * 800 : shantenDelta < 0 ? shantenDelta * 500 : 0;
    const ukeireDelta = afterUkeire - beforeUkeire;
    const ukeireReward = ukeireDelta * 10 + Math.max(0, afterUkeire) * 0.6;
    const scoreDelta = afterScorePotential - beforeScorePotential;
    const crossed10 = beforeScorePotential < 10 && afterScorePotential >= 10 ? 50 : 0;
    const crossed20 = beforeScorePotential < 20 && afterScorePotential >= 20 ? 50 : 0;
    const scoreBonus = scoreDelta * 2 + crossed10 + crossed20;
    const riskWeight = emergencyDefense ? 1.4 : 0.08 + 0.27 / (1 + Math.exp(-0.12 * (dangerScore - 55)));
    const dangerPenalty = dangerScore * riskWeight;
    return {
      shantenReward,
      ukeireReward,
      scoreBonus,
      dangerPenalty,
      total: shantenReward + ukeireReward + scoreBonus - dangerPenalty,
      emergencyDefense
    };
  }
  shouldEmergencyDefend(gameState, playerIndex, beforeSteps = 3) {
    if (!gameState || playerIndex === void 0) {
      return false;
    }
    if (beforeSteps < 2) {
      return false;
    }
    return gameState.players.some((player, index) => {
      if (index === playerIndex) {
        return false;
      }
      const exposedHu = (player.melds || []).reduce((sum, meld) => sum + (meld.huPoints || 0), 0);
      const matureShape = (player.melds?.length || 0) >= 3 || (player.cards?.length || 0) <= 6 || !!player.isBao;
      return exposedHu >= 15 && matureShape;
    });
  }
};

// src/ai/action-priority-scorer.ts
var ActionPriorityScorer = class {
  scoreDiscardCandidate(params) {
    const listeningBonus = params.waitCount > 0 ? (params.beforeWaitCount > 0 ? 260 : 1e3) + params.remainingWaitCount * 14 + params.maxRoundScore * 3 : 0;
    const tingBonus = params.waitCount > 0 ? params.waitCount * 28 + params.remainingWaitCount * 5 + params.maxRoundScore * 1.8 : 0;
    const deadTileBonus = params.isIsolated ? 42 : params.isNearlyDead ? 18 : 0;
    const trashQueueBonus = params.isIsolated && params.preservesTempo ? 88 : params.isNearlyDead && params.preservesTempo ? 20 : 0;
    const stableStructurePenalty = params.stableStructureLoss * 52;
    const anchorPenalty = params.shapeAnchorStrength * 1.2 + params.exactMeldAnchorStrength * 68;
    const redDangerPenalty = params.isRed ? 20 : 0;
    return params.breakdownTotal + params.compositeScore * 0.18 - params.keepValue + listeningBonus + tingBonus + deadTileBonus + trashQueueBonus - stableStructurePenalty - anchorPenalty - redDangerPenalty;
  }
  scoreDiscardPriority(params) {
    return Math.round(
      56 + params.candidateScore * 0.18 - params.rankIndex * 6 + params.breakdownTotal * 0.04 + params.speedScore * 6 + params.winRate * 18 + params.expectedScore * 1.4 + params.trashQueueRank * 4 + params.pseudoLooseRank * 2
    );
  }
  scorePassPriority(breakdownTotal) {
    return Math.round(36 + breakdownTotal * 0.04);
  }
  scoreResponseDelta(params) {
    return params.breakdownTotal * 0.05 + (params.evaluationCompositeScore - params.passCompositeScore);
  }
  scoreResponsePriority(basePriority, breakdownTotal) {
    return Math.round(basePriority + breakdownTotal * 0.06);
  }
  scoreChiRawDelta(params) {
    const followUpBonus = params.followUpWaitDelta * 10 + params.followUpScoreDelta * 1.5;
    const selfDrawTempoBonus = params.selfDraw ? 8 + Math.max(0, params.stepDelta) * 2 : 0;
    const routeBonus = params.routeImproved ? 4 : 0;
    const staleRoutePenalty = !params.routeImproved && params.stepDelta <= 0 && params.tingDelta <= 0 && params.followUpWaitDelta <= 0 && params.followUpScoreDelta <= 0 ? 10 : 0;
    return params.evaluationCompositeScore - params.passCompositeScore + params.formedUnitDelta * 6 + params.tingDelta * 4 + params.stepDelta * 5 + params.huDelta * 1.6 + followUpBonus + selfDrawTempoBonus + routeBonus - staleRoutePenalty;
  }
  scoreChiDelta(params) {
    return params.rawDelta + Math.max(0, params.breakdownTotal) * 0.03;
  }
  scoreChiPriority(params) {
    return Math.round(44 + params.breakdownTotal * 0.06 + Math.max(params.delta, 0) * 0.4);
  }
  scorePostResponseDiscard(params) {
    return params.compositeScore - params.keepValue + params.waitCount * 24 + params.remainingWaitCount * 8 + params.maxRoundScore * 2 + params.avgHuPoints - params.dangerScore * 0.55;
  }
};

// src/ai/policy-artifact.ts
var DEFAULT_POLICY_WIN_RATE_WEIGHT = 100;
var DEFAULT_POLICY_EXPECTED_SCORE_WEIGHT = 2.5;
var DEFAULT_POLICY_HEAD_MIN_SAMPLE_COUNT = 24;
var DEFAULT_POLICY_STAGE_ADJUSTMENT_MIN_SAMPLE_COUNT = 12;
var FEATURE_LABELS = {
  heuristic_win_rate: "\u542F\u53D1\u5F0F\u80DC\u7387",
  heuristic_expected_score: "\u542F\u53D1\u5F0F\u671F\u671B\u5206",
  heuristic_priority: "\u542F\u53D1\u5F0F\u4F18\u5148\u7EA7",
  wait_count: "\u542C\u53E3\u6570",
  remaining_wait_count: "\u8FDB\u5F20\u603B\u91CF",
  max_round_score: "\u6700\u5927\u5355\u5C40\u5206",
  danger_score: "\u5371\u9669\u5206",
  speed_score: "\u901F\u5EA6\u8BC4\u5206",
  ukeire_score: "\u8FDB\u5F20\u6548\u7387",
  score_bonus: "\u5206\u6570\u5956\u52B1",
  tempo_gain: "\u5411\u542C\u6539\u5584",
  tempo_loss: "\u5411\u542C\u5012\u9000",
  ukeire_delta_score: "\u8FDB\u5F20\u53D8\u5316",
  score_cross_10_flag: "\u8DE810\u80E1",
  score_cross_20_flag: "\u8DE820\u80E1",
  dead_tile_flag: "\u6B7B\u5F20\u6807\u8BB0",
  isolated_flag: "\u5B64\u5F20\u6807\u8BB0",
  nearly_dead_flag: "\u8FD1\u6B7B\u5F20\u6807\u8BB0",
  stable_structure_loss: "\u7A33\u5B9A\u7ED3\u6784\u635F\u5931",
  flexibility_score: "\u8DEF\u7EBF\u5F39\u6027",
  response_value: "\u54CD\u5E94\u8FDB\u5F20\u4EF7\u503C",
  response_action_chi: "\u5403\u724C\u54CD\u5E94",
  response_action_peng: "\u78B0\u724C\u54CD\u5E94",
  response_action_zhao: "\u62DB\u724C\u54CD\u5E94",
  response_action_pass: "\u8FC7\u724C\u54CD\u5E94",
  post_response_discard_risk: "\u54CD\u5E94\u540E\u5F03\u724C\u98CE\u9669",
  bipai_extra_meld_count: "\u6BD4\u724C\u989D\u5916\u6210\u5217",
  gui_value: "\u5F52\u6F5C\u529B",
  live_response_sequence_count: "\u987A\u5B50\u54CD\u5E94\u8FDB\u5F20",
  live_response_2710_count: "\u4E8C\u4E03\u5341\u54CD\u5E94\u8FDB\u5F20",
  dead_response_sequence_count: "\u6B7B\u987A\u5B50\u54CD\u5E94",
  dead_response_2710_count: "\u6B7B\u4E8C\u4E03\u5341\u54CD\u5E94",
  stable_response_block_count: "\u7A33\u5B9A\u7EC4\u963B\u585E",
  viable_pair_templates: "\u5BF9\u5B50\u6A21\u677F\u6570",
  viable_mixed_templates: "\u5927\u5C0F\u642D\u6A21\u677F\u6570",
  viable_sequence_templates: "\u987A\u5B50\u6A21\u677F\u6570",
  viable_2710_templates: "\u4E8C\u4E03\u5341\u6A21\u677F\u6570",
  blocked_template_count: "\u53D7\u963B\u6A21\u677F\u6570",
  free_support_count: "\u81EA\u7531\u652F\u6491\u6570",
  total_live_support: "\u603B\u6D3B\u652F\u6491\u6570",
  preserves_tempo_flag: "\u4E0D\u964D\u901F\u6807\u8BB0",
  exact_meld_anchor_strength: "\u6210\u578B\u951A\u70B9\u5F3A\u5EA6",
  shape_anchor_strength: "\u724C\u578B\u951A\u70B9\u5F3A\u5EA6",
  turn_count: "\u56DE\u5408\u6570",
  deck_pressure: "\u724C\u5C71\u538B\u529B",
  opening_flag: "\u5F00\u5C40\u9636\u6BB5",
  midgame_flag: "\u4E2D\u5C40\u9636\u6BB5",
  endgame_flag: "\u6B8B\u5C40\u9636\u6BB5"
};
var DEFAULT_POLICY_ARTIFACT = {
  policyVersion: "learned-v1-1774237565697",
  featureSchemaVersion: "discard-v1",
  generatedAt: "2026-03-23T03:46:05.764Z",
  policyName: "Learned Discard Policy v4-mid",
  objective: "dual_balanced",
  scoreWeights: {
    blocked_template_count: 8e-3,
    danger_score: -0.036,
    dead_response_2710_count: -0.059,
    dead_response_sequence_count: -0.029,
    dead_tile_flag: 0.011,
    exact_meld_anchor_strength: -0.07,
    flexibility_score: -0.034,
    free_support_count: -0.047,
    gui_value: 0,
    heuristic_expected_score: 0.179,
    heuristic_priority: 0.059,
    heuristic_win_rate: 0.131,
    isolated_flag: -0.029,
    live_response_2710_count: 0,
    live_response_sequence_count: -0.031,
    max_round_score: 0,
    nearly_dead_flag: -0.02,
    preserves_tempo_flag: 0.089,
    remaining_wait_count: -0.036,
    response_value: -0.031,
    score_bonus: 0,
    shape_anchor_strength: -0.082,
    speed_score: 0.08,
    stable_response_block_count: -0.037,
    stable_structure_loss: 0.174,
    total_live_support: 0.134,
    ukeire_score: 0.014,
    viable_2710_templates: 0.143,
    viable_mixed_templates: -0.017,
    viable_pair_templates: -0.106,
    viable_sequence_templates: -0.144,
    wait_count: -0.064
  },
  normalizationStats: {
    blocked_template_count: { mean: 0.029, std: 0.2064899543300722 },
    danger_score: { mean: 10.254, std: 20.75427722433114 },
    dead_response_2710_count: { mean: 7e-3, std: 0.08481666601970757 },
    dead_response_sequence_count: { mean: 0.065, std: 0.27469407856557826 },
    dead_tile_flag: { mean: 0.058, std: 0.23368863038546528 },
    exact_meld_anchor_strength: { mean: 0.628, std: 1.5887634475168135 },
    flexibility_score: { mean: 5.423, std: 13.847141200765684 },
    free_support_count: { mean: 0.819, std: 1.9308161045676069 },
    gui_value: { mean: 0, std: 1e-3 },
    heuristic_expected_score: { mean: 3.819, std: 8.041770937745296 },
    heuristic_priority: { mean: 88.673, std: 325.2600419671828 },
    heuristic_win_rate: { mean: 0.138, std: 0.27556733138614986 },
    isolated_flag: { mean: 0.058, std: 0.23368863038546528 },
    live_response_2710_count: { mean: 0, std: 1e-3 },
    live_response_sequence_count: { mean: 0.116, std: 0.5906575035453571 },
    max_round_score: { mean: 0, std: 1e-3 },
    nearly_dead_flag: { mean: 0.043, std: 0.20393111999232325 },
    preserves_tempo_flag: { mean: 0.188, std: 0.3910358713980307 },
    remaining_wait_count: { mean: 1.493, std: 3.597999397434107 },
    response_value: { mean: 0.116, std: 0.5906575035453571 },
    score_bonus: { mean: 0, std: 1e-3 },
    shape_anchor_strength: { mean: 7.475, std: 18.81712453042074 },
    speed_score: { mean: 0.176, std: 0.34631787291898436 },
    stable_response_block_count: { mean: 0.043, std: 0.2916610405434503 },
    stable_structure_loss: { mean: 0.222, std: 0.7321537743796546 },
    total_live_support: { mean: 0.906, std: 2.186545422891648 },
    ukeire_score: { mean: 0.255, std: 0.5102987890038538 },
    viable_2710_templates: { mean: 0.022, std: 0.1458305202717254 },
    viable_mixed_templates: { mean: 0.123, std: 0.38921881165205136 },
    viable_pair_templates: { mean: 0.109, std: 0.3112569796364424 },
    viable_sequence_templates: { mean: 0.203, std: 0.6720013402533108 },
    wait_count: { mean: 1.203, std: 2.8416147182718774 }
  },
  objectiveBias: 0,
  predictionWeights: {
    winRate: {
      blocked_template_count: 0.083,
      danger_score: 5e-3,
      dead_response_2710_count: -0.046,
      dead_response_sequence_count: -0.012,
      dead_tile_flag: -0.03,
      exact_meld_anchor_strength: -0.049,
      flexibility_score: -0.03,
      free_support_count: -5e-3,
      gui_value: 0,
      heuristic_expected_score: 0.046,
      heuristic_priority: 0.209,
      heuristic_win_rate: 0.191,
      isolated_flag: -4e-3,
      live_response_2710_count: 0,
      live_response_sequence_count: -0.021,
      max_round_score: 0,
      nearly_dead_flag: -0.089,
      preserves_tempo_flag: -0.017,
      remaining_wait_count: -0.082,
      response_value: -0.021,
      score_bonus: 0,
      shape_anchor_strength: -0.037,
      speed_score: 0.122,
      stable_response_block_count: -0.118,
      stable_structure_loss: 0.172,
      total_live_support: 0.122,
      ukeire_score: 0.012,
      viable_2710_templates: 0.145,
      viable_mixed_templates: 0.083,
      viable_pair_templates: -0.191,
      viable_sequence_templates: -0.106,
      wait_count: -0.15
    },
    expectedScore: {
      blocked_template_count: -0.045,
      danger_score: -0.06,
      dead_response_2710_count: -0.061,
      dead_response_sequence_count: -0.037,
      dead_tile_flag: 0.038,
      exact_meld_anchor_strength: -0.076,
      flexibility_score: -0.032,
      free_support_count: -0.071,
      gui_value: 0,
      heuristic_expected_score: 0.249,
      heuristic_priority: -0.052,
      heuristic_win_rate: 0.074,
      isolated_flag: -0.043,
      live_response_2710_count: 0,
      live_response_sequence_count: -0.034,
      max_round_score: 0,
      nearly_dead_flag: 0.03,
      preserves_tempo_flag: 0.152,
      remaining_wait_count: 0,
      response_value: -0.034,
      score_bonus: 0,
      shape_anchor_strength: -0.103,
      speed_score: 0.043,
      stable_response_block_count: 0.023,
      stable_structure_loss: 0.154,
      total_live_support: 0.127,
      ukeire_score: 0.013,
      viable_2710_templates: 0.124,
      viable_mixed_templates: -0.083,
      viable_pair_templates: -0.035,
      viable_sequence_templates: -0.153,
      wait_count: 3e-3
    }
  },
  predictionBias: {
    winRate: 0,
    expectedScore: 0
  },
  predictionTargetStats: {
    winRate: { mean: 0.633, std: 0.147 },
    expectedScore: { mean: 13.703, std: 8.5 }
  },
  trainingMeta: {
    iteration: 1,
    sampledDecisionCount: 1448,
    selfPlayGames: 2,
    rolloutCountPerAction: 1,
    seed: 20260319,
    validationSampleCount: 481.6666666666667,
    retainedSampleCount: 1445,
    filteredSampleCount: 3,
    lowSignalSampleCount: 3,
    lowSignalRatio: 0.0020718232044198894,
    pairwiseRowCount: 8616,
    skippedFeatureCoverageSampleCount: 0,
    hardExampleSampleCount: 716
  }
};
var activePolicyArtifact = DEFAULT_POLICY_ARTIFACT;
function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
function normalizeFeature(key, value, artifact) {
  const stats = artifact.normalizationStats?.[key];
  if (!stats || !Number.isFinite(stats.std) || stats.std === 0) {
    return value;
  }
  return (value - stats.mean) / stats.std;
}
function mergeWeights(base, delta) {
  if (!base && !delta) {
    return void 0;
  }
  const merged = {
    ...base || {}
  };
  for (const [key, value] of Object.entries(delta || {})) {
    merged[key] = (merged[key] || 0) + value;
  }
  return merged;
}
function resolveHeadModel(artifact, context) {
  if (!context.actionFamily) {
    return void 0;
  }
  const headModel = artifact.familyHeads?.[context.actionFamily];
  if (!headModel) {
    return void 0;
  }
  const minSampleCount = headModel.activationMinSampleCount ?? DEFAULT_POLICY_HEAD_MIN_SAMPLE_COUNT;
  if ((headModel.sampleCount ?? 0) < minSampleCount) {
    return void 0;
  }
  return headModel;
}
function getActivePolicyArtifact() {
  return activePolicyArtifact;
}
function loadPolicyArtifact(artifact) {
  activePolicyArtifact = artifact ?? DEFAULT_POLICY_ARTIFACT;
  return activePolicyArtifact;
}
function resetPolicyArtifact() {
  activePolicyArtifact = DEFAULT_POLICY_ARTIFACT;
  return activePolicyArtifact;
}
function scorePolicyFeatures(features, artifact = activePolicyArtifact, context = {}) {
  const headModel = resolveHeadModel(artifact, context);
  const stageAdjustment = (() => {
    if (!context.stage) {
      return void 0;
    }
    const candidate = headModel?.stageAdjustments?.[context.stage];
    if (!candidate) {
      return void 0;
    }
    const minStageSampleCount = headModel?.stageActivationMinSampleCount ?? DEFAULT_POLICY_STAGE_ADJUSTMENT_MIN_SAMPLE_COUNT;
    return (candidate.sampleCount ?? 0) >= minStageSampleCount ? candidate : void 0;
  })();
  const effectiveScoreWeights = mergeWeights(
    headModel?.scoreWeights ?? artifact.scoreWeights,
    stageAdjustment?.scoreWeightDelta
  ) || {};
  const effectiveObjectiveBias = (headModel?.objectiveBias ?? artifact.objectiveBias ?? 0) + (stageAdjustment?.objectiveBiasDelta ?? 0);
  const effectiveWinRateWeights = mergeWeights(
    headModel?.predictionWeights?.winRate ?? artifact.predictionWeights?.winRate,
    stageAdjustment?.predictionWeightDelta?.winRate
  );
  const effectiveExpectedScoreWeights = mergeWeights(
    headModel?.predictionWeights?.expectedScore ?? artifact.predictionWeights?.expectedScore,
    stageAdjustment?.predictionWeightDelta?.expectedScore
  );
  const effectiveWinRateBias = (headModel?.predictionBias?.winRate ?? artifact.predictionBias?.winRate ?? 0) + (stageAdjustment?.predictionBiasDelta?.winRate ?? 0);
  const effectiveExpectedScoreBias = (headModel?.predictionBias?.expectedScore ?? artifact.predictionBias?.expectedScore ?? 0) + (stageAdjustment?.predictionBiasDelta?.expectedScore ?? 0);
  const contributions = Object.entries(effectiveScoreWeights).map(([key, weight]) => {
    const value = features[key] ?? 0;
    const normalizedValue = normalizeFeature(key, value, artifact);
    return {
      key,
      label: FEATURE_LABELS[key] || key,
      value,
      weight,
      contribution: normalizedValue * weight
    };
  }).sort((left, right) => Math.abs(right.contribution) - Math.abs(left.contribution));
  const normalizedKeys = /* @__PURE__ */ new Set([
    ...Object.keys(effectiveScoreWeights),
    ...Object.keys(effectiveWinRateWeights || {}),
    ...Object.keys(effectiveExpectedScoreWeights || {})
  ]);
  const normalizedFeatureValues = /* @__PURE__ */ new Map();
  for (const key of normalizedKeys) {
    normalizedFeatureValues.set(key, normalizeFeature(key, features[key] ?? 0, artifact));
  }
  const totalContribution = contributions.reduce((sum, item) => sum + item.contribution, 0) + effectiveObjectiveBias;
  const heuristicWinRate = clamp(features.heuristic_win_rate ?? 0, 0, 1);
  const heuristicExpectedScore = Math.max(0, features.heuristic_expected_score ?? 0);
  const policyScore = Math.round(totalContribution * 10);
  const predictedWinRate = effectiveWinRateWeights ? clamp(
    denormalizePrediction(
      effectiveWinRateBias,
      effectiveWinRateWeights,
      headModel?.predictionTargetStats?.winRate ?? artifact.predictionTargetStats?.winRate,
      normalizedFeatureValues
    ),
    0,
    1
  ) : clamp(
    heuristicWinRate + totalContribution * 22e-4 + (features.remaining_wait_count ?? 0) * 15e-4 - (features.danger_score ?? 0) * 25e-5,
    0,
    1
  );
  const predictedExpectedScore = effectiveExpectedScoreWeights ? Math.max(
    0,
    denormalizePrediction(
      effectiveExpectedScoreBias,
      effectiveExpectedScoreWeights,
      headModel?.predictionTargetStats?.expectedScore ?? artifact.predictionTargetStats?.expectedScore,
      normalizedFeatureValues
    )
  ) : Math.max(
    0,
    heuristicExpectedScore + totalContribution * 0.08 + (features.max_round_score ?? 0) * 0.15 + (features.gui_value ?? 0) * 0.6
  );
  const contributionMean = contributions.length > 0 ? contributions.reduce((sum, item) => sum + item.contribution, 0) / contributions.length : 0;
  const contributionVariance = contributions.length > 0 ? contributions.reduce((sum, item) => {
    const distance = item.contribution - contributionMean;
    return sum + distance * distance;
  }, 0) / contributions.length : 0;
  const predictedScoreVariance = Math.max(
    0,
    contributionVariance * 0.08 + Math.max(0, (features.danger_score ?? 0) - 35) * 0.06 + Math.max(0, 4 - (features.remaining_wait_count ?? 0)) * 0.3
  );
  return {
    policyScore,
    predictedWinRate,
    predictedExpectedScore,
    predictedScoreVariance,
    featureContributions: contributions.slice(0, 5)
  };
}
function denormalizePrediction(bias, weights, targetStats, normalizedFeatureValues) {
  let normalizedPrediction = bias;
  for (const [key, weight] of Object.entries(weights)) {
    normalizedPrediction += (normalizedFeatureValues.get(key) ?? 0) * weight;
  }
  const std = targetStats?.std && Number.isFinite(targetStats.std) && targetStats.std > 0 ? targetStats.std : 1;
  const mean = targetStats?.mean && Number.isFinite(targetStats.mean) ? targetStats.mean : 0;
  return normalizedPrediction * std + mean;
}
function computePolicyObjective(input, weights = {}) {
  const winRateWeight = weights.winRateWeight ?? DEFAULT_POLICY_WIN_RATE_WEIGHT;
  const expectedScoreWeight = weights.expectedScoreWeight ?? DEFAULT_POLICY_EXPECTED_SCORE_WEIGHT;
  return input.predictedWinRate * winRateWeight + input.predictedExpectedScore * expectedScoreWeight;
}
function computePolicyPriority(input) {
  const objective = computePolicyObjective(input);
  return objective * 100 + (input.policyScore ?? 0) * 0.01 + (input.baselinePriority ?? 0) * 1e-4;
}

// src/ai/policy-ranking.ts
function computeRecommendationPriorityByMode(mode, input) {
  if (mode !== "learned") {
    return input.baselinePriority;
  }
  return computePolicyPriority({
    predictedWinRate: input.predictedWinRate,
    predictedExpectedScore: input.predictedExpectedScore,
    policyScore: input.policyScore,
    baselinePriority: input.baselinePriority
  });
}

// src/ai/policy-feature-builder.ts
var STRUCTURAL_FEATURE_KEYS = [
  "stable_structure_loss",
  "flexibility_score",
  "viable_pair_templates",
  "viable_mixed_templates",
  "viable_sequence_templates",
  "viable_2710_templates",
  "blocked_template_count",
  "free_support_count",
  "total_live_support",
  "exact_meld_anchor_strength",
  "shape_anchor_strength",
  "tempo_gain",
  "score_cross_10_flag",
  "score_cross_20_flag",
  "response_action_chi",
  "response_action_peng",
  "response_action_zhao",
  "response_action_pass",
  "post_response_discard_risk",
  "bipai_extra_meld_count"
];
function clampNonNegative(value, fallback = 0) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(0, value);
}
function extractActionType(recommendation, fallbackAction) {
  if (typeof recommendation?.action === "string" && recommendation.action.length > 0) {
    return recommendation.action;
  }
  if (typeof fallbackAction?.type === "string" && fallbackAction.type.length > 0) {
    return fallbackAction.type;
  }
  return "discard";
}
function inferPolicyStage(turnCount, remainingDeckCards) {
  if (turnCount <= 3 && remainingDeckCards > 14) {
    return "opening";
  }
  if (remainingDeckCards <= 7 || turnCount >= 16) {
    return "endgame";
  }
  return "midgame";
}
function inferPolicyActionFamily(actionType, phase) {
  if (phase === "response_collecting") {
    return "response";
  }
  if (actionType === "chi" || actionType === "peng" || actionType === "zhao" || actionType === "pass" || actionType === "hu") {
    return "response";
  }
  return "discard";
}
function hasCriticalPolicyFeatureCoverage(features, family) {
  if (!features || Object.keys(features).length === 0) {
    return false;
  }
  if (family === "response") {
    const responseSignal = clampNonNegative(features.response_value) + clampNonNegative(features.live_response_sequence_count) + clampNonNegative(features.live_response_2710_count) + clampNonNegative(features.total_live_support) + clampNonNegative(features.flexibility_score);
    return responseSignal > 0;
  }
  const structuralCount = STRUCTURAL_FEATURE_KEYS.filter((key) => clampNonNegative(features[key]) > 0).length;
  const baselineSignal = clampNonNegative(features.wait_count) + clampNonNegative(features.remaining_wait_count) + clampNonNegative(features.speed_score);
  return structuralCount >= 2 || structuralCount >= 1 && baselineSignal > 0;
}
function deriveResponseValue(actionType, tempoGain) {
  if (actionType === "chi") {
    return 1.6 + Math.max(0, tempoGain);
  }
  if (actionType === "peng") {
    return 1.2 + Math.max(0, tempoGain * 0.5);
  }
  if (actionType === "zhao") {
    return 1.8 + Math.max(0, tempoGain * 0.5);
  }
  if (actionType === "pass") {
    return Math.max(0, tempoGain * 0.8);
  }
  if (actionType === "hu") {
    return 2.5;
  }
  return 0;
}
function hasSignal(recommendation, pattern) {
  const texts = [
    recommendation?.reasoning,
    recommendation?.summary,
    ...recommendation?.keyPoints || [],
    ...recommendation?.evidence?.signals || []
  ];
  return texts.some((text) => !!text && pattern.test(text));
}
function buildPolicyFeatures(recommendation, fallbackAction, state) {
  const actionType = extractActionType(recommendation, fallbackAction);
  const turnCount = clampNonNegative(state?.turnCount, 0);
  const remainingDeckCards = clampNonNegative(state?.remainingDeckCards, 0);
  const stage = inferPolicyStage(turnCount, remainingDeckCards);
  const actionFamily = inferPolicyActionFamily(actionType, state?.phase);
  if (recommendation?.policyFeatures) {
    return {
      features: recommendation.policyFeatures,
      stage,
      actionFamily,
      hasStructuralCoverage: hasCriticalPolicyFeatureCoverage(
        recommendation.policyFeatures,
        actionFamily
      )
    };
  }
  const evidence = recommendation?.evidence;
  const breakdown = evidence?.breakdown;
  const tempoGain = clampNonNegative(evidence?.tempoGain, 0);
  const rawTempoGain = typeof evidence?.tempoGain === "number" && Number.isFinite(evidence.tempoGain) ? evidence.tempoGain : 0;
  const heuristicWinRate = clampNonNegative(recommendation?.winRate, 0);
  const waitCount = clampNonNegative(evidence?.waitCount, 0);
  const remainingWaitCount = clampNonNegative(evidence?.ukeireCount, 0);
  const flexibility = clampNonNegative(evidence?.flexibility, 0.35);
  const maxRoundScore = clampNonNegative(evidence?.maxRoundScore, recommendation?.expectedScore ?? 0);
  const deadTileFlag = recommendation?.keyPoints?.some((item) => /死张|孤张|伪活/.test(item)) ? 1 : 0;
  const isolatedFlag = recommendation?.keyPoints?.some((item) => /孤张/.test(item)) ? 1 : 0;
  const nearlyDeadFlag = recommendation?.keyPoints?.some((item) => /拖手|活张不多/.test(item)) ? 1 : 0;
  const deckPressure = Math.max(0, 1 - Math.min(remainingDeckCards, 20) / 20);
  const structuralSeed = waitCount + remainingWaitCount * 0.3 + flexibility * 0.4;
  const responseValue = deriveResponseValue(actionType, tempoGain);
  const sequenceSignal = hasSignal(recommendation, /顺子|联|连续|衔接|路线|结构/);
  const special2710Signal = hasSignal(recommendation, /二七十|2710|贰柒拾|红牌|红/);
  const mixedSignal = hasSignal(recommendation, /大小|叉|混搭|搭子/);
  const bipaiExtraMeldCount = Math.max(
    0,
    Math.round((recommendation?.meldCards?.length || 0) / 3) - 1
  );
  const liveResponseSequenceCount = actionFamily === "response" && actionType === "chi" && sequenceSignal ? 1 : 0;
  const liveResponse2710Count = actionFamily === "response" && special2710Signal ? 1 : 0;
  const deadResponseSequenceCount = deadTileFlag > 0 || actionFamily === "response" && actionType === "pass" && sequenceSignal ? 1 : 0;
  const deadResponse2710Count = nearlyDeadFlag > 0 || actionFamily === "response" && actionType === "pass" && special2710Signal ? 1 : 0;
  const stableResponseBlockCount = deadTileFlag > 0 && responseValue <= 0 ? 1 : 0;
  const viablePairTemplates = Math.max(0, Math.round(structuralSeed * 0.2 + (actionType === "peng" ? 1 : 0)));
  const viableMixedTemplates = Math.max(0, Math.round(structuralSeed * 0.12 + (mixedSignal ? 1 : 0)));
  const viableSequenceTemplates = Math.max(0, Math.round(structuralSeed * 0.18 + (sequenceSignal ? 1 : 0)));
  const viable2710Templates = Math.max(0, Math.round(structuralSeed * 0.08 + (special2710Signal ? 1 : 0)));
  const blockedTemplateCount = Math.max(0, deadTileFlag + nearlyDeadFlag);
  const freeSupportCount = Math.max(0, flexibility * 0.2 + responseValue * 0.1);
  const totalLiveSupport = Math.max(
    0,
    freeSupportCount + liveResponseSequenceCount + liveResponse2710Count
  );
  const exactMeldAnchorStrength = Math.max(0, maxRoundScore * 0.05 + remainingWaitCount * 0.2);
  const shapeAnchorStrength = Math.max(0, flexibility + waitCount * 0.5);
  const features = {
    heuristic_win_rate: heuristicWinRate,
    heuristic_expected_score: clampNonNegative(recommendation?.expectedScore, maxRoundScore),
    heuristic_priority: clampNonNegative(
      recommendation?.baselinePriority ?? recommendation?.priority,
      0
    ),
    wait_count: waitCount,
    remaining_wait_count: remainingWaitCount,
    max_round_score: maxRoundScore,
    danger_score: clampNonNegative(evidence?.dangerScore, 0),
    speed_score: clampNonNegative(evidence?.speedScore, heuristicWinRate),
    ukeire_score: clampNonNegative(breakdown?.ukeireReward, 0),
    score_bonus: clampNonNegative(breakdown?.scoreBonus, 0),
    tempo_gain: rawTempoGain,
    tempo_loss: Math.max(0, -rawTempoGain),
    ukeire_delta_score: clampNonNegative(breakdown?.ukeireReward, 0),
    score_cross_10_flag: (breakdown?.scoreBonus || 0) >= 50 || maxRoundScore >= 10 ? 1 : 0,
    score_cross_20_flag: maxRoundScore >= 20 ? 1 : 0,
    dead_tile_flag: deadTileFlag,
    isolated_flag: isolatedFlag,
    nearly_dead_flag: nearlyDeadFlag,
    stable_structure_loss: breakdown?.shantenReward ? Math.max(0, -breakdown.shantenReward) : 0,
    flexibility_score: flexibility,
    response_value: responseValue,
    response_action_chi: actionType === "chi" ? 1 : 0,
    response_action_peng: actionType === "peng" ? 1 : 0,
    response_action_zhao: actionType === "zhao" ? 1 : 0,
    response_action_pass: actionType === "pass" ? 1 : 0,
    post_response_discard_risk: actionFamily === "response" ? clampNonNegative(evidence?.dangerScore, 0) : 0,
    bipai_extra_meld_count: bipaiExtraMeldCount,
    gui_value: 0,
    live_response_sequence_count: liveResponseSequenceCount,
    live_response_2710_count: liveResponse2710Count,
    dead_response_sequence_count: deadResponseSequenceCount,
    dead_response_2710_count: deadResponse2710Count,
    stable_response_block_count: stableResponseBlockCount,
    viable_pair_templates: viablePairTemplates,
    viable_mixed_templates: viableMixedTemplates,
    viable_sequence_templates: viableSequenceTemplates,
    viable_2710_templates: viable2710Templates,
    blocked_template_count: blockedTemplateCount,
    free_support_count: freeSupportCount,
    total_live_support: totalLiveSupport,
    preserves_tempo_flag: tempoGain >= 0 ? 1 : 0,
    exact_meld_anchor_strength: exactMeldAnchorStrength,
    shape_anchor_strength: shapeAnchorStrength,
    turn_count: turnCount,
    deck_pressure: deckPressure,
    opening_flag: stage === "opening" ? 1 : 0,
    midgame_flag: stage === "midgame" ? 1 : 0,
    endgame_flag: stage === "endgame" ? 1 : 0
  };
  return {
    features,
    stage,
    actionFamily,
    hasStructuralCoverage: hasCriticalPolicyFeatureCoverage(features, actionFamily)
  };
}

// src/ai/recommendation-generator.ts
var AIRecommendationGenerator = class {
  constructor(deps) {
    this.deps = deps;
    this.priorityScorer = new ActionPriorityScorer();
  }
  generateRecommendations(gameState, playerIndex, handCards, melds, config) {
    const recommendations = [];
    const availableActions = gameState.availableActions || [];
    const player = gameState.players[playerIndex];
    const discardedCards = gameState.discardPile?.cards || [];
    if (!player) return recommendations;
    const huAction = availableActions.find((action) => action.type === "hu");
    if (huAction) {
      const evidence = this.deps.buildDecisionEvidence({
        evaluation: { winRate: 1, expectedScore: Math.max(10, gameState.winningRoundScore || 0), compositeScore: 100, posture: "attack", speedScore: 1, scorePotential: Math.max(10, gameState.winningRoundScore || 0), defensePressure: 0, confidence: 0.98, summary: "\u5DF2\u7ECF\u5F62\u6210\u76F4\u63A5\u5F97\u5206\u673A\u4F1A" },
        listening: { waitCards: [], remainingWaitCount: 0, maxHuPoints: gameState.winningHuPoints || 0, avgHuPoints: 0, maxRoundScore: Math.max(10, gameState.winningRoundScore || 0), avgRoundScore: 0, bestMingTangNames: [] },
        extraSignals: ["\u5F53\u524D\u5DF2\u7ECF\u6EE1\u8DB3\u80E1\u724C\u6761\u4EF6", "\u7EE7\u7EED\u8D2A\u5927\u53CD\u800C\u4F1A\u589E\u52A0\u8D70\u5F62\u548C\u653E\u70AE\u98CE\u9669"]
      });
      const teaching = this.deps.buildTeachingPayload("hu", "attack", evidence, "\u5DF2\u7ECF\u5F62\u6210\u76F4\u63A5\u5F97\u5206\u673A\u4F1A\uFF0C\u4F18\u5148\u7A33\u7A33\u6536\u5206\u3002", ["\u5F53\u524D\u5DF2\u7ECF\u6EE1\u8DB3\u80E1\u724C\u6761\u4EF6", "\u7EE7\u7EED\u8D2A\u5927\u53CD\u800C\u4F1A\u589E\u52A0\u8D70\u5F62\u548C\u653E\u70AE\u98CE\u9669"]);
      recommendations.push({
        action: "hu",
        reasoning: "\u73B0\u5728\u5DF2\u7ECF\u80FD\u80E1\uFF0C\u800C\u4E14\u5206\u6570\u5DF2\u7ECF\u843D\u888B\uFF0C\u5148\u6536\u5206\u6700\u7A33\uFF0C\u4E0D\u5FC5\u518D\u5192\u653E\u70AE\u548C\u8D70\u5F62\u7684\u98CE\u9669",
        winRate: 1,
        expectedScore: Math.max(10, gameState.winningRoundScore || 0),
        riskLevel: "low",
        posture: "attack",
        ...teaching,
        confidence: 0.98,
        priority: 100
      });
    }
    const analysis = this.deps.handAnalyzer.analyze(handCards, melds);
    const baseProjection = this.deps.evaluateProjectedState(handCards, melds, discardedCards, gameState);
    const baseListening = this.deps.evaluateDiscardListening(gameState, handCards, melds);
    if (!huAction && analysis.canWin) {
      const breakdown = this.deps.buildEvBreakdown({
        gameState,
        playerIndex,
        beforeSteps: 1,
        afterSteps: 0,
        beforeUkeire: baseListening.remainingWaitCount,
        afterUkeire: 0,
        beforeScorePotential: baseProjection.scorePotential,
        afterScorePotential: analysis.totalHuPoints || 0,
        dangerScore: 0
      });
      const evidence = this.deps.buildDecisionEvidence({
        evaluation: { winRate: 1, expectedScore: analysis.totalHuPoints || 0, compositeScore: 100, posture: "attack", speedScore: 1, scorePotential: analysis.totalHuPoints || 0, defensePressure: 0, confidence: 0.96, summary: "\u724C\u5DF2\u7ECF\u6210\u719F" },
        listening: { waitCards: [], remainingWaitCount: 0, maxHuPoints: analysis.totalHuPoints || 0, avgHuPoints: 0, maxRoundScore: analysis.totalHuPoints || 0, avgRoundScore: 0, bestMingTangNames: [] },
        breakdown,
        extraSignals: ["\u5F53\u524D\u5DF2\u6210\u80E1", "\u8FD9\u65F6\u7EE7\u7EED\u62D6\u4E00\u624B\u901A\u5E38\u4E0D\u5982\u76F4\u63A5\u5151\u73B0\u6536\u76CA"]
      });
      const teaching = this.deps.buildTeachingPayload("hu", "attack", evidence, "\u724C\u5DF2\u7ECF\u6210\u719F\uFF0C\u5148\u628A\u786E\u5B9A\u6536\u76CA\u62FF\u4E0B\u3002", ["\u5F53\u524D\u5DF2\u6210\u80E1", "\u8FD9\u65F6\u7EE7\u7EED\u62D6\u4E00\u624B\u901A\u5E38\u4E0D\u5982\u76F4\u63A5\u5151\u73B0\u6536\u76CA"]);
      recommendations.push({
        action: "hu",
        reasoning: "\u624B\u724C\u5DF2\u7ECF\u6210\u80E1\uFF0C\u7EE7\u7EED\u8D2A\u66F4\u5927\u7684\u6536\u76CA\u5E76\u4E0D\u5212\u7B97\uFF0C\u7ACB\u5373\u80E1\u724C\u66F4\u50CF\u7A33\u5065\u9AD8\u624B\u7684\u5904\u7406",
        winRate: 1,
        expectedScore: analysis.totalHuPoints || 0,
        riskLevel: "low",
        posture: "attack",
        ...teaching,
        confidence: 0.96,
        priority: 100
      });
    }
    if (gameState.phase === "response_collecting") {
      recommendations.push(...this.buildResponseRecommendations(gameState, playerIndex, baseProjection, baseListening, analysis));
    }
    const zhaoAction = availableActions.find((action) => action.type === "zhao");
    if (zhaoAction && !recommendations.some((item) => item.action === "zhao")) {
      const evidence = this.deps.buildDecisionEvidence({
        evaluation: { winRate: 0.66, expectedScore: 8, compositeScore: 78, posture: "attack", speedScore: 0.58, scorePotential: 8, defensePressure: 0.18, confidence: 0.82, summary: "\u62DB\u724C\u504F\u7ACB\u5206" },
        extraSignals: ["\u76F4\u63A5\u589E\u52A0\u80E1\u606F", "\u591A\u6570\u60C5\u51B5\u4E0B\u8FD8\u80FD\u4FDD\u7559\u540E\u7EED\u4E3B\u5E72"],
        flexibility: 0.52
      });
      const teaching = this.deps.buildTeachingPayload("zhao", "attack", evidence, "\u62DB\u724C\u80FD\u76F4\u63A5\u505A\u9AD8\u5206\u6570\uFF0C\u800C\u4E14\u901A\u5E38\u4E0D\u4F24\u7ED3\u6784\u3002", ["\u76F4\u63A5\u589E\u52A0\u80E1\u606F", "\u591A\u6570\u60C5\u51B5\u4E0B\u8FD8\u80FD\u4FDD\u7559\u540E\u7EED\u4E3B\u5E72"]);
      recommendations.push({
        action: "zhao",
        meldCards: zhaoAction.cards,
        reasoning: "\u8FD9\u6B65\u62DB\u724C\u4F1A\u76F4\u63A5\u52A0\u80E1\u606F\uFF0C\u800C\u4E14\u901A\u5E38\u4E0D\u4F1A\u7834\u574F\u4E3B\u5E72\uFF0C\u5C5E\u4E8E\u6536\u76CA\u660E\u786E\u7684\u8FDB\u653B\u52A8\u4F5C",
        winRate: 0.66,
        expectedScore: 8,
        riskLevel: "low",
        posture: "attack",
        ...teaching,
        confidence: 0.82,
        priority: 88
      });
    }
    const pengAction = availableActions.find((action) => action.type === "peng");
    if (pengAction && !recommendations.some((item) => item.action === "peng")) {
      const evidence = this.deps.buildDecisionEvidence({
        evaluation: { winRate: 0.54, expectedScore: 4, compositeScore: 62, posture: "balance", speedScore: 0.42, scorePotential: 4, defensePressure: 0.32, confidence: 0.68, summary: "\u78B0\u540E\u7ED3\u6784\u66F4\u56FA\u5B9A" },
        extraSignals: ["\u5F53\u524D\u6536\u76CA\u660E\u786E", "\u78B0\u540E\u724C\u578B\u4F1A\u66F4\u56FA\u5B9A\uFF0C\u8981\u7559\u610F\u4E0B\u4E00\u5F20\u600E\u4E48\u6253"],
        flexibility: 0.28
      });
      const teaching = this.deps.buildTeachingPayload("peng", "balance", evidence, "\u78B0\u724C\u80FD\u7ACB\u523B\u505A\u5B9E\u4E00\u7EC4\uFF0C\u4F46\u4F1A\u51CF\u5C11\u540E\u7EED\u8F6C\u8EAB\u7A7A\u95F4\u3002", ["\u5F53\u524D\u6536\u76CA\u660E\u786E", "\u78B0\u540E\u724C\u578B\u4F1A\u66F4\u56FA\u5B9A\uFF0C\u8981\u7559\u610F\u4E0B\u4E00\u5F20\u600E\u4E48\u6253"]);
      recommendations.push({
        action: "peng",
        meldCards: pengAction.cards,
        reasoning: pengAction.cards.some((card) => card.isRed) ? "\u78B0\u8FD9\u5F20\u80FD\u628A\u7EA2\u724C\u6536\u76CA\u7ACB\u4F4F\uFF0C\u4F46\u4E5F\u4F1A\u8BA9\u624B\u724C\u66F4\u56FA\u5B9A\uFF0C\u8981\u770B\u540E\u7EED\u5F03\u724C\u662F\u5426\u5B89\u5168" : "\u78B0\u540E\u7ED3\u6784\u66F4\u6574\u9F50\uFF0C\u9002\u5408\u5F53\u524D\u504F\u8FDB\u653B\u7684\u8282\u594F",
        winRate: 0.54,
        expectedScore: 4,
        riskLevel: "medium",
        posture: "balance",
        ...teaching,
        confidence: 0.68,
        priority: 62
      });
    }
    if (gameState.phase === "discarding") {
      const legalDiscardIds = new Set(
        availableActions.filter((action) => action.type === "discard" && action.cards?.[0]?.id).map((action) => action.cards[0].id)
      );
      const beforeAnalysis = this.deps.handAnalyzer.analyze(handCards, melds);
      const sortedCards = handCards.filter((card) => legalDiscardIds.has(card.id)).map((card) => {
        const remainingCards = handCards.filter((candidate) => candidate.id !== card.id);
        const afterAnalysis = this.deps.handAnalyzer.analyze(remainingCards, melds);
        const listening = this.deps.evaluateDiscardListening(gameState, remainingCards, melds);
        const evaluation = this.deps.evaluateProjectedState(remainingCards, melds, [...discardedCards, card], gameState);
        const profile = this.deps.getCardConnectionProfile(card, handCards, melds, gameState);
        const keepValue = this.deps.calculateKeepValue(card, handCards, melds, gameState);
        const resolvedDanger = this.deps.assessDiscardDanger(card, gameState, playerIndex);
        const stableStructureLoss = Math.max(0, this.countStableStructures(beforeAnalysis) - this.countStableStructures(afterAnalysis));
        const preservesTempo = (afterAnalysis.stepsToWin || 3) <= (beforeAnalysis.stepsToWin || 3);
        const exactMeldAnchorStrength = this.countExactMeldAnchors(card, handCards);
        const shapeAnchorStrength = Math.max(0, profile.sequenceLinks - 2) * 18 + (profile.mixedSizeCards > 0 ? 18 : 0) + (profile.sameCards === 0 && profile.sequenceLinks >= 3 ? 16 : 0) + exactMeldAnchorStrength * 12;
        const pseudoLooseRank = this.getPseudoLooseRank(card, handCards, profile, preservesTempo);
        const trashQueueRank = profile.isIsolated ? 2 : profile.isNearlyDead && preservesTempo ? 1 : 0;
        const breakdown = this.deps.buildEvBreakdown({
          gameState,
          playerIndex,
          beforeSteps: beforeAnalysis.stepsToWin,
          afterSteps: afterAnalysis.stepsToWin,
          beforeUkeire: baseListening.remainingWaitCount,
          afterUkeire: listening.remainingWaitCount,
          beforeScorePotential: baseProjection.scorePotential,
          afterScorePotential: Math.max(evaluation.scorePotential, listening.maxRoundScore),
          dangerScore: resolvedDanger.score
        });
        return {
          card,
          listening,
          profile,
          danger: resolvedDanger,
          keepValue,
          evaluation,
          breakdown,
          tempoGain: (beforeAnalysis.stepsToWin || 3) - (afterAnalysis.stepsToWin || 3),
          trashQueueRank,
          pseudoLooseRank,
          score: this.priorityScorer.scoreDiscardCandidate({
            beforeWaitCount: baseListening.waitCards.length,
            breakdownTotal: breakdown.total,
            compositeScore: evaluation.compositeScore,
            keepValue,
            waitCount: listening.waitCards.length,
            remainingWaitCount: listening.remainingWaitCount,
            maxRoundScore: listening.maxRoundScore,
            isRed: card.isRed,
            isIsolated: profile.isIsolated,
            isNearlyDead: profile.isNearlyDead,
            preservesTempo,
            shapeAnchorStrength,
            exactMeldAnchorStrength,
            stableStructureLoss
          })
        };
      });
      sortedCards.sort((left, right) => right.trashQueueRank - left.trashQueueRank || right.pseudoLooseRank - left.pseudoLooseRank || right.score - left.score || right.evaluation.winRate - left.evaluation.winRate);
      for (let index = 0; index < Math.min(3, sortedCards.length); index++) {
        const item = sortedCards[index];
        const evidence = this.deps.buildDecisionEvidence({
          evaluation: item.evaluation,
          listening: item.listening,
          danger: item.danger,
          breakdown: item.breakdown,
          tempoGain: item.tempoGain,
          flexibility: Math.max(0, Math.min(1, item.keepValue / 24))
        });
        const teaching = this.deps.buildTeachingPayload(
          "discard",
          item.evaluation.posture,
          evidence,
          this.deps.buildRecommendationSummary("discard", item.evaluation.posture, ""),
          this.deps.buildDiscardKeyPoints(item.listening, item.profile, item.danger, item.evaluation)
        );
        recommendations.push({
          action: "discard",
          card: item.card,
          reasoning: this.deps.generateDiscardReasoning(item.card, item.evaluation, item.keepValue, item.listening, item.profile, item.danger),
          winRate: item.evaluation.winRate,
          expectedScore: Math.max(item.evaluation.expectedScore, item.listening.maxRoundScore),
          riskLevel: item.danger.label,
          posture: item.evaluation.posture,
          ...teaching,
          confidence: Math.max(0.45, Math.min(0.95, item.evaluation.confidence - index * 0.08)),
          priority: this.priorityScorer.scoreDiscardPriority({
            rankIndex: index,
            breakdownTotal: item.breakdown.total,
            speedScore: item.evaluation.speedScore,
            candidateScore: item.evaluation.compositeScore,
            winRate: item.evaluation.winRate,
            expectedScore: Math.max(item.evaluation.expectedScore, item.listening.maxRoundScore),
            trashQueueRank: item.trashQueueRank,
            pseudoLooseRank: item.pseudoLooseRank
          })
        });
      }
    }
    const chiAction = availableActions.find((action) => action.type === "chi");
    if (chiAction && gameState.phase !== "response_collecting" && !recommendations.some((item) => item.action === "chi")) {
      const evidence = this.deps.buildDecisionEvidence({
        evaluation: { winRate: 0.45, expectedScore: 2, compositeScore: 48, posture: "balance", speedScore: 0.38, scorePotential: 2, defensePressure: 0.28, confidence: 0.56, summary: "\u6536\u76CA\u4E00\u822C" },
        extraSignals: ["\u8981\u7ED3\u5408\u5403\u540E\u5F03\u724C\u662F\u5426\u5B89\u5168", "\u4E0D\u80FD\u53EA\u770B\u773C\u524D\u80FD\u4E0D\u80FD\u6210\u4E00\u7EC4"],
        flexibility: 0.34
      });
      const teaching = this.deps.buildTeachingPayload("chi", "balance", evidence, "\u8FD9\u6B65\u80FD\u5403\uFF0C\u4F46\u6536\u76CA\u8FD8\u6CA1\u5927\u5230\u53EF\u4EE5\u65E0\u8111\u6267\u884C\u3002", ["\u8981\u7ED3\u5408\u5403\u540E\u5F03\u724C\u662F\u5426\u5B89\u5168", "\u4E0D\u80FD\u53EA\u770B\u773C\u524D\u80FD\u4E0D\u80FD\u6210\u4E00\u7EC4"]);
      recommendations.push({
        action: "chi",
        meldCards: chiAction.cards,
        reasoning: "\u8FD9\u6B65\u5403\u724C\u6709\u57FA\u7840\u6536\u76CA\uFF0C\u4F46\u8FD8\u8981\u770B\u5403\u5B8C\u4E4B\u540E\u4E22\u54EA\u5F20\u66F4\u5B89\u5168\uFF0C\u4E0D\u80FD\u53EA\u770B\u773C\u524D\u80FD\u4E0D\u80FD\u5403",
        winRate: 0.45,
        expectedScore: 2,
        riskLevel: "medium",
        posture: "balance",
        ...teaching,
        confidence: 0.56,
        priority: 40
      });
    }
    this.enrichRecommendationsWithPolicy(recommendations, gameState, config?.policyMode);
    recommendations.sort((left, right) => right.priority - left.priority);
    return recommendations;
  }
  buildResponseRecommendations(gameState, playerIndex, passEvaluation, passListening, passAnalysis) {
    const player = gameState.players[playerIndex];
    const targetCard = gameState.discardPile?.lastDiscard;
    if (!player) return [];
    const resolvedPass = this.resolvePassState(
      gameState,
      playerIndex,
      player.cards,
      player.melds,
      targetCard,
      passEvaluation,
      passListening,
      passAnalysis
    );
    const recommendations = [];
    if (gameState.availableActions.find((action) => action.type === "pass")) {
      const passBreakdown = this.deps.buildEvBreakdown({
        gameState,
        playerIndex,
        beforeSteps: passAnalysis.stepsToWin,
        afterSteps: resolvedPass.analysis.stepsToWin,
        beforeUkeire: passListening.remainingWaitCount,
        afterUkeire: resolvedPass.listening.remainingWaitCount,
        beforeScorePotential: passEvaluation.scorePotential,
        afterScorePotential: Math.max(resolvedPass.evaluation.scorePotential, resolvedPass.listening.maxRoundScore),
        dangerScore: Math.round(resolvedPass.evaluation.defensePressure * 100)
      });
      const evidence = this.deps.buildDecisionEvidence({
        evaluation: resolvedPass.evaluation,
        listening: resolvedPass.listening,
        breakdown: passBreakdown,
        tempoGain: (passAnalysis.stepsToWin || 3) - (resolvedPass.analysis.stepsToWin || 3),
        extraSignals: [resolvedPass.evaluation.summary, "\u5F53\u524D\u8FD9\u5F20\u724C\u5E26\u6765\u7684\u5373\u65F6\u6536\u76CA\u8FD8\u4E0D\u591F\u5927"],
        flexibility: 0.62
      });
      const teaching = this.deps.buildTeachingPayload("pass", resolvedPass.evaluation.posture, evidence, "\u5148\u8FC7\u662F\u4E3A\u4E86\u4FDD\u4F4F\u8DEF\u7EBF\u5F39\u6027\uFF0C\u4E0D\u662F\u7B80\u5355\u653E\u5F03\u3002", [resolvedPass.evaluation.summary, "\u5F53\u524D\u8FD9\u5F20\u724C\u5E26\u6765\u7684\u5373\u65F6\u6536\u76CA\u8FD8\u4E0D\u591F\u5927"]);
      recommendations.push({
        action: "pass",
        reasoning: resolvedPass.bestDiscard ? `\u5148\u8FC7\u540E\u518D\u987A\u624B\u8C03\u6574 ${this.deps.formatCardCode(resolvedPass.bestDiscard)}\uFF0C\u6574\u4F53\u8DEF\u7EBF\u5E76\u4E0D\u6BD4\u54CD\u5E94\u5DEE` : "\u5148\u8FC7\u7684\u610F\u601D\u4E0D\u662F\u653E\u5F03\uFF0C\u800C\u662F\u8FD9\u4E00\u6B65\u5E26\u6765\u7684\u80E1\u606F\u3001\u756A\u6570\u548C\u540E\u7EED\u4EF7\u503C\u90FD\u4E0D\u591F\u660E\u663E\uFF0C\u5148\u628A\u624B\u724C\u5F39\u6027\u7559\u4F4F",
        winRate: resolvedPass.evaluation.winRate,
        expectedScore: Math.max(resolvedPass.evaluation.expectedScore, resolvedPass.listening.maxRoundScore),
        riskLevel: "low",
        posture: resolvedPass.evaluation.posture,
        ...teaching,
        confidence: resolvedPass.evaluation.confidence,
        priority: this.priorityScorer.scorePassPriority(passBreakdown.total)
      });
    }
    const pengAction = gameState.availableActions.find((action) => action.type === "peng");
    if (pengAction && targetCard) {
      const sameCards = player.cards.filter((card) => card.value === targetCard.value && card.size === targetCard.size).slice(0, 2);
      if (sameCards.length === 2) {
        const meld = { type: "peng", cards: [...sameCards, targetCard], isConcealed: false, position: "table", huPoints: 0 };
        const remainingCards = player.cards.filter((card) => !sameCards.some((same) => same.id === card.id));
        const evaluation = this.deps.evaluateProjectedState(remainingCards, [...player.melds, meld], gameState.discardPile?.cards || [], gameState);
        const afterAnalysis = this.deps.handAnalyzer.analyze(remainingCards, [...player.melds, meld]);
        const afterListening = this.deps.evaluateDiscardListening(gameState, remainingCards, [...player.melds, meld]);
        const breakdown = this.deps.buildEvBreakdown({
          gameState,
          playerIndex,
          beforeSteps: passAnalysis.stepsToWin,
          afterSteps: afterAnalysis.stepsToWin,
          beforeUkeire: passListening.remainingWaitCount,
          afterUkeire: afterListening.remainingWaitCount,
          beforeScorePotential: passEvaluation.scorePotential,
          afterScorePotential: Math.max(evaluation.scorePotential, afterListening.maxRoundScore),
          dangerScore: Math.round(evaluation.defensePressure * 100)
        });
        const delta = this.priorityScorer.scoreResponseDelta({
          breakdownTotal: breakdown.total,
          evaluationCompositeScore: evaluation.compositeScore,
          passCompositeScore: passEvaluation.compositeScore
        });
        const evidence = this.deps.buildDecisionEvidence({
          evaluation,
          listening: afterListening,
          breakdown,
          danger: { score: delta >= 0 ? 48 : 72, label: delta >= 0 ? "medium" : "high", summary: delta >= 0 ? "\u6536\u76CA\u80FD\u8986\u76D6\u4E00\u90E8\u5206\u540E\u624B\u538B\u529B" : "\u8FD9\u6B65\u4F1A\u8BA9\u540E\u7EED\u5904\u7406\u7A7A\u95F4\u53D8\u7A84" },
          tempoGain: delta / 20,
          flexibility: delta >= 0 ? 0.34 : 0.18,
          extraSignals: [evaluation.summary, delta >= 0 ? "\u8FD9\u624B\u66F4\u50CF\u4E3B\u52A8\u7ACB\u5206" : "\u8FD9\u4E00\u78B0\u4F1A\u538B\u7F29\u540E\u7EED\u5B89\u5168\u5F03\u724C\u7A7A\u95F4"]
        });
        const teaching = this.deps.buildTeachingPayload("peng", evaluation.posture, evidence, delta >= 0 ? "\u78B0\u540E\u6536\u76CA\u80FD\u76D6\u8FC7\u8DEF\u7EBF\u635F\u5931\u3002" : "\u78B0\u867D\u7136\u6210\u7ACB\uFF0C\u4F46\u540E\u624B\u4F1A\u53D8\u50F5\u3002", [evaluation.summary, delta >= 0 ? "\u8FD9\u624B\u66F4\u50CF\u4E3B\u52A8\u7ACB\u5206" : "\u8FD9\u4E00\u78B0\u4F1A\u538B\u7F29\u540E\u7EED\u5B89\u5168\u5F03\u724C\u7A7A\u95F4"]);
        recommendations.push({
          action: "peng",
          meldCards: pengAction.cards,
          reasoning: delta >= 0 ? "\u78B0\u8FD9\u5F20\u80FD\u628A\u773C\u524D\u6536\u76CA\u5148\u7ACB\u4F4F\uFF0C\u65E2\u8865\u80E1\u606F\uFF0C\u4E5F\u8BA9\u724C\u578B\u66F4\u96C6\u4E2D" : "\u78B0\u662F\u80FD\u78B0\uFF0C\u4F46\u78B0\u5B8C\u624B\u724C\u592A\u50F5\uFF0C\u540E\u9762\u53CD\u800C\u66F4\u5BB9\u6613\u88AB\u8FEB\u6253\u5371\u9669\u5F20\uFF0C\u4E0D\u5982\u5148\u8FC7",
          winRate: evaluation.winRate,
          expectedScore: evaluation.expectedScore,
          riskLevel: delta >= 0 ? "medium" : "high",
          posture: evaluation.posture,
          ...teaching,
          confidence: evaluation.confidence,
          priority: this.priorityScorer.scoreResponsePriority(delta >= 0 ? 56 : 24, breakdown.total)
        });
      }
    }
    const zhaoAction = gameState.availableActions.find((action) => action.type === "zhao");
    if (zhaoAction && targetCard) {
      const sameCards = player.cards.filter((card) => card.value === targetCard.value && card.size === targetCard.size).slice(0, 3);
      if (sameCards.length === 3) {
        const meld = { type: "draw_quadruple", cards: [...sameCards, targetCard], isConcealed: false, position: "table", huPoints: 0 };
        const remainingCards = player.cards.filter((card) => !sameCards.some((same) => same.id === card.id));
        const evaluation = this.deps.evaluateProjectedState(remainingCards, [...player.melds, meld], gameState.discardPile?.cards || [], gameState);
        const afterAnalysis = this.deps.handAnalyzer.analyze(remainingCards, [...player.melds, meld]);
        const afterListening = this.deps.evaluateDiscardListening(gameState, remainingCards, [...player.melds, meld]);
        const breakdown = this.deps.buildEvBreakdown({
          gameState,
          playerIndex,
          beforeSteps: passAnalysis.stepsToWin,
          afterSteps: afterAnalysis.stepsToWin,
          beforeUkeire: passListening.remainingWaitCount,
          afterUkeire: afterListening.remainingWaitCount,
          beforeScorePotential: passEvaluation.scorePotential,
          afterScorePotential: Math.max(evaluation.scorePotential, afterListening.maxRoundScore),
          dangerScore: Math.round(evaluation.defensePressure * 100)
        });
        const delta = this.priorityScorer.scoreResponseDelta({
          breakdownTotal: breakdown.total,
          evaluationCompositeScore: evaluation.compositeScore,
          passCompositeScore: passEvaluation.compositeScore
        });
        const evidence = this.deps.buildDecisionEvidence({
          evaluation,
          listening: afterListening,
          breakdown,
          tempoGain: delta / 18,
          flexibility: 0.48,
          extraSignals: [evaluation.summary, "\u62DB\u724C\u901A\u5E38\u4E0D\u4F1A\u50CF\u78B0\u724C\u90A3\u6837\u660E\u663E\u7834\u574F\u4E3B\u5E72"]
        });
        const teaching = this.deps.buildTeachingPayload("zhao", "attack", evidence, delta >= 0 ? "\u62DB\u724C\u7684\u76F4\u63A5\u5F97\u5206\u4EF7\u503C\u5F88\u9AD8\u3002" : "\u8FD9\u6B65\u504F\u7ACB\u5206\uFF0C\u63D0\u901F\u6536\u76CA\u53CD\u800C\u4E00\u822C\u3002", [evaluation.summary, "\u62DB\u724C\u901A\u5E38\u4E0D\u4F1A\u50CF\u78B0\u724C\u90A3\u6837\u660E\u663E\u7834\u574F\u4E3B\u5E72"]);
        recommendations.push({
          action: "zhao",
          meldCards: zhaoAction.cards,
          reasoning: delta >= 0 ? "\u62DB\u8FD9\u5F20\u80FD\u76F4\u63A5\u628A\u5206\u6570\u505A\u9AD8\uFF0C\u800C\u4E14\u62DB\u540E\u7ED3\u6784\u901A\u5E38\u8FD8\u7A33\uFF0C\u5C5E\u4E8E\u6536\u76CA\u5F88\u76F4\u767D\u7684\u9009\u62E9" : "\u867D\u7136\u80FD\u62DB\uFF0C\u4F46\u62DB\u5B8C\u540E\u7EED\u8854\u63A5\u4E00\u822C\uFF0C\u8FD9\u4E00\u6B65\u66F4\u591A\u662F\u7ACB\u5206\u800C\u4E0D\u662F\u63D0\u901F",
          winRate: evaluation.winRate,
          expectedScore: evaluation.expectedScore,
          riskLevel: "low",
          posture: "attack",
          ...teaching,
          confidence: Math.max(0.72, evaluation.confidence),
          priority: this.priorityScorer.scoreResponsePriority(60, breakdown.total)
        });
      }
    }
    const chiAction = gameState.availableActions.find((action) => action.type === "chi");
    if (chiAction && targetCard) {
      const bestChi = (chiAction.chiOptions || []).map((option) => {
        const meldType = this.deps.rulesValidator.detectChiMeldType(option.mainMeldCards);
        if (!meldType) return null;
        const mainMeld = { type: meldType, cards: option.mainMeldCards, isConcealed: false, position: "table", huPoints: 0 };
        const afterMelds = [...player.melds, mainMeld, ...option.additionalMelds];
        const rawEvaluation = this.deps.evaluateProjectedState(option.remainingCards, afterMelds, gameState.discardPile?.cards || [], gameState);
        const afterAnalysis = this.deps.handAnalyzer.analyze(option.remainingCards, afterMelds);
        const followUp = this.evaluateBestPostResponseDiscard(option.remainingCards, afterMelds, gameState, playerIndex);
        const finalEvaluation = followUp.bestEvaluation || rawEvaluation;
        const finalAnalysis = followUp.bestAnalysis || afterAnalysis;
        const finalListening = followUp.bestListening || this.deps.evaluateDiscardListening(gameState, option.remainingCards, afterMelds);
        const formedUnitDelta = afterAnalysis.melds.length + afterAnalysis.potentialMelds.length - (resolvedPass.analysis.melds.length + resolvedPass.analysis.potentialMelds.length);
        const tingDelta = afterAnalysis.tingCards.length - resolvedPass.analysis.tingCards.length;
        const stepDelta = (resolvedPass.analysis.stepsToWin || 3) - (finalAnalysis.stepsToWin || afterAnalysis.stepsToWin || 3);
        const huDelta = (afterAnalysis.totalHuPoints || 0) - (resolvedPass.analysis.totalHuPoints || 0);
        const breakdown = this.deps.buildEvBreakdown({
          gameState,
          playerIndex,
          beforeSteps: resolvedPass.analysis.stepsToWin,
          afterSteps: afterAnalysis.stepsToWin,
          beforeUkeire: resolvedPass.listening.remainingWaitCount,
          afterUkeire: finalListening.remainingWaitCount,
          beforeScorePotential: Math.max(resolvedPass.evaluation.scorePotential, resolvedPass.listening.maxRoundScore),
          afterScorePotential: Math.max(rawEvaluation.scorePotential, finalListening.maxRoundScore),
          dangerScore: followUp.bestDanger?.score ?? Math.round(finalEvaluation.defensePressure * 100)
        });
        const followUpWaitDelta = finalListening.remainingWaitCount - resolvedPass.listening.remainingWaitCount;
        const followUpScoreDelta = finalListening.maxRoundScore - resolvedPass.listening.maxRoundScore;
        const meaningfulGain = stepDelta > 0 || tingDelta > 0 || followUpWaitDelta > 0 || followUpScoreDelta > 0 || huDelta > 0 || option.additionalMelds.length > 0;
        const structureBonus = meldType === "mixed_size" || meldType === "special_2710" ? 8 : 0;
        const realizedMeldBonus = meaningfulGain ? (1 + option.additionalMelds.length) * 6 + option.additionalMelds.length * 6 + structureBonus : 0;
        const weakSequencePenalty = meldType === "sequence" && option.additionalMelds.length === 0 && stepDelta <= 0 && tingDelta <= 0 && followUpWaitDelta <= 0 && followUpScoreDelta <= 0 ? 30 : 0;
        const rawDelta = this.priorityScorer.scoreChiRawDelta({
          evaluationCompositeScore: rawEvaluation.compositeScore,
          passCompositeScore: resolvedPass.evaluation.compositeScore,
          formedUnitDelta,
          tingDelta,
          stepDelta,
          huDelta,
          followUpWaitDelta: finalListening.waitCards.length,
          followUpScoreDelta: finalListening.maxRoundScore,
          selfDraw: gameState.pendingCardSource === "draw",
          routeImproved: afterAnalysis.potentialMelds.filter((meld) => meld.type !== "pair").length > resolvedPass.analysis.potentialMelds.filter((meld) => meld.type !== "pair").length || (afterAnalysis.stepsToWin ?? 99) < (resolvedPass.analysis.stepsToWin ?? 99)
        }) + realizedMeldBonus - weakSequencePenalty;
        const delta = this.priorityScorer.scoreChiDelta({ rawDelta, breakdownTotal: breakdown.total });
        return { option, meldType, meaningfulGain, weakSequence: weakSequencePenalty > 0, evaluation: finalEvaluation, listening: finalListening, followUp, rawDelta, delta, stepDelta, huDelta, breakdown };
      }).filter((item) => !!item).sort((left, right) => right.delta - left.delta)[0];
      const shouldRecommendChi = !!bestChi && (bestChi.rawDelta > 0 || !bestChi.weakSequence && bestChi.rawDelta > (bestChi.meldType === "sequence" ? -2 : -8) && (bestChi.meldType !== "sequence" || bestChi.stepDelta > 0 || (bestChi.listening.remainingWaitCount || 0) > (resolvedPass.listening.remainingWaitCount || 0) || bestChi.option.additionalMelds.length > 0));
      if (bestChi && shouldRecommendChi) {
        const evidence = this.deps.buildDecisionEvidence({
          evaluation: bestChi.evaluation,
          listening: bestChi.listening,
          breakdown: bestChi.breakdown,
          tempoGain: bestChi.stepDelta,
          danger: bestChi.followUp.bestDanger,
          flexibility: bestChi.followUp.bestListening ? 0.58 : 0.42,
          extraSignals: [bestChi.evaluation.summary, bestChi.followUp.bestListening ? "\u5403\u540E\u8FD8\u6709\u660E\u786E\u7684\u7EE7\u7EED\u6574\u7406\u65B9\u6848" : "\u91CD\u70B9\u5728\u4E8E\u628A\u624B\u724C\u7406\u987A\uFF0C\u800C\u4E0D\u53EA\u662F\u591A\u4E00\u7EC4"]
        });
        const teaching = this.deps.buildTeachingPayload("chi", bestChi.evaluation.posture, evidence, bestChi.delta >= 10 ? "\u8FD9\u6B65\u5403\u724C\u4F1A\u660E\u663E\u6539\u5584\u540E\u7EED\u8282\u594F\u3002" : "\u8FD9\u6B65\u5403\u724C\u80FD\u6539\u5584\u7ED3\u6784\uFF0C\u4F46\u4E0D\u662F\u7EDD\u5BF9\u5F3A\u5236\u3002", [bestChi.evaluation.summary, bestChi.followUp.bestListening ? "\u5403\u540E\u8FD8\u6709\u660E\u786E\u7684\u7EE7\u7EED\u6574\u7406\u65B9\u6848" : "\u91CD\u70B9\u5728\u4E8E\u628A\u624B\u724C\u7406\u987A\uFF0C\u800C\u4E0D\u53EA\u662F\u591A\u4E00\u7EC4"]);
        recommendations.push({
          action: "chi",
          meldCards: bestChi.option.selectedCards,
          reasoning: bestChi.followUp.bestListening ? `\u5403\u8FD9\u5F20\u540E\uFF0C\u82E5\u987A\u624B\u518D\u8C03\u6574 ${bestChi.followUp.bestDiscard ? this.deps.formatCardCode(bestChi.followUp.bestDiscard) : "\u4E00\u5F20"}\uFF0C\u80FD\u66F4\u5FEB\u505A\u6210\u542C\u724C\uFF0C\u800C\u4E14\u540E\u7EED\u5355\u5C40\u5206\u66F4\u9AD8` : bestChi.stepDelta > 0 ? "\u5403\u8FD9\u5F20\u540E\u4F1A\u660E\u663E\u63D0\u901F\uFF0C\u79BB\u542C\u724C\u66F4\u8FD1\uFF0C\u4E0D\u53EA\u662F\u8D26\u9762\u4E0A\u591A\u4E00\u7EC4\u724C" : bestChi.huDelta > 0 ? "\u5403\u5B8C\u540E\u80E1\u606F\u66F4\u539A\uFF0C\u5C5E\u4E8E\u53C8\u63D0\u901F\u53C8\u589E\u5206\u7684\u8FDB\u653B\u52A8\u4F5C" : "\u5403\u8FD9\u5F20\u540E\u6574\u4F53\u8854\u63A5\u66F4\u987A\uFF0C\u5C5E\u4E8E\u4EBA\u624B\u5E38\u8BF4\u7684\u987A\u724C\u505A\u6D3B",
          winRate: bestChi.evaluation.winRate,
          expectedScore: Math.max(bestChi.evaluation.expectedScore, bestChi.followUp.bestListening?.maxRoundScore || 0),
          riskLevel: bestChi.delta >= 10 ? "medium" : "low",
          posture: bestChi.evaluation.posture,
          ...teaching,
          confidence: bestChi.evaluation.confidence,
          priority: this.priorityScorer.scoreChiPriority({
            breakdownTotal: bestChi.breakdown.total,
            delta: bestChi.delta
          })
        });
      }
    }
    return recommendations.sort((left, right) => right.priority - left.priority);
  }
  enrichRecommendationsWithPolicy(recommendations, gameState, policyMode) {
    if (policyMode !== "learned") return recommendations;
    const artifact = getActivePolicyArtifact();
    if (!artifact) return recommendations;
    for (const rec of recommendations) {
      rec.baselinePriority = rec.priority;
      const { features, stage, actionFamily } = buildPolicyFeatures(rec, void 0, gameState);
      const scored = scorePolicyFeatures(features, artifact, { actionFamily, stage });
      rec.policyScore = scored.policyScore;
      rec.predictedWinRate = scored.predictedWinRate;
      rec.predictedExpectedScore = scored.predictedExpectedScore;
      rec.predictedScoreVariance = scored.predictedScoreVariance;
      rec.featureContributions = scored.featureContributions;
      rec.policyFeatures = features;
      rec.policyVersion = artifact.policyVersion;
      rec.policySource = "learned";
      rec.priority = computeRecommendationPriorityByMode("learned", {
        predictedWinRate: scored.predictedWinRate,
        predictedExpectedScore: scored.predictedExpectedScore,
        policyScore: scored.policyScore,
        baselinePriority: rec.baselinePriority
      });
    }
    const sorted = [...recommendations].sort((a, b) => b.priority - a.priority);
    const best = sorted[0];
    if (best) {
      for (const rec of recommendations) {
        rec.deltaFromBest = {
          winRate: (rec.predictedWinRate ?? 0) - (best.predictedWinRate ?? 0),
          expectedScore: (rec.predictedExpectedScore ?? 0) - (best.predictedExpectedScore ?? 0)
        };
      }
    }
    return recommendations;
  }
  countStableStructures(analysis) {
    const weightByType = {
      quadruple: 4.8,
      triple: 4.2,
      special_2710: 4,
      mixed_size: 3.6,
      sequence: 3,
      pair: 1
    };
    return (analysis.potentialMelds || []).reduce((sum, meld) => {
      return sum + (weightByType[meld.type] || 0);
    }, 0);
  }
  countExactMeldAnchors(card, handCards) {
    const otherCards = handCards.filter((candidate) => candidate.id !== card.id);
    const sameSizeCards = otherCards.filter((candidate) => candidate.size === card.size);
    const countValue = (value) => sameSizeCards.filter((candidate) => candidate.value === value).length;
    let anchorCount = 0;
    if (otherCards.filter((candidate) => candidate.value === card.value && candidate.size === card.size).length >= 2) {
      anchorCount += 2;
    }
    if (otherCards.filter((candidate) => candidate.value === card.value && candidate.size !== card.size).length >= 2) {
      anchorCount += 1.5;
    }
    for (let start = card.value - 2; start <= card.value; start++) {
      if (start < 1 || start + 2 > 10) {
        continue;
      }
      const otherValues = [start, start + 1, start + 2].filter((value) => value !== card.value);
      if (otherValues.every((value) => countValue(value) > 0)) {
        anchorCount += 1;
      }
    }
    if ([2, 7, 10].includes(card.value)) {
      const required = [2, 7, 10].filter((value) => value !== card.value);
      if (required.every((value) => countValue(value) > 0)) {
        anchorCount += 2.6;
      }
    }
    return anchorCount;
  }
  getPseudoLooseRank(card, handCards, profile, preservesTempo) {
    if (profile.sameCards === 0 && profile.sequenceLinks === 0 && profile.specialLinks === 0 && profile.mixedSizeCards === 1) {
      return 2;
    }
    if (profile.sameCards > 0 || profile.mixedSizeCards > 1) {
      return 0;
    }
    const otherCards = handCards.filter((candidate) => candidate.id !== card.id && candidate.size === card.size);
    const sameSizeCounts = /* @__PURE__ */ new Map();
    for (const candidate of otherCards) {
      sameSizeCounts.set(candidate.value, (sameSizeCounts.get(candidate.value) || 0) + 1);
    }
    const exactSequenceRoutes = [];
    for (let start = card.value - 2; start <= card.value; start++) {
      if (start < 1 || start + 2 > 10) {
        continue;
      }
      const otherValues = [start, start + 1, start + 2].filter((value) => value !== card.value);
      if (otherValues.every((value) => (sameSizeCounts.get(value) || 0) > 0)) {
        exactSequenceRoutes.push(otherValues);
      }
    }
    if (exactSequenceRoutes.length !== 1) {
      return 0;
    }
    const neighborLoad = exactSequenceRoutes[0].reduce((sum, value) => sum + (sameSizeCounts.get(value) || 0), 0);
    const overloadedNeighbor = exactSequenceRoutes[0].some((value) => (sameSizeCounts.get(value) || 0) >= 3);
    const edgeRoute = exactSequenceRoutes[0].includes(card.value - 1) === false || exactSequenceRoutes[0].includes(card.value + 1) === false;
    if ((overloadedNeighbor || neighborLoad >= 5) && (preservesTempo || edgeRoute)) {
      return edgeRoute ? 2 : 1;
    }
    return 0;
  }
  resolvePassState(gameState, playerIndex, handCards, melds, targetCard, baseEvaluation, baseListening, baseAnalysis) {
    return {
      evaluation: baseEvaluation,
      listening: baseListening,
      analysis: baseAnalysis
    };
  }
  evaluateBestPostResponseDiscard(handCards, melds, gameState, playerIndex) {
    let bestScore = Number.NEGATIVE_INFINITY;
    let bestDiscard;
    let bestListening;
    let bestEvaluation;
    let bestAnalysis;
    let bestDanger;
    for (const candidate of handCards) {
      const remainingCards = handCards.filter((card) => card.id !== candidate.id);
      const listening = this.deps.evaluateDiscardListening(gameState, remainingCards, melds);
      const projection = this.deps.evaluateProjectedState(remainingCards, melds, gameState.discardPile?.cards || [], gameState);
      const analysis = this.deps.handAnalyzer.analyze(remainingCards, melds);
      const keepValue = this.deps.calculateKeepValue(candidate, handCards, melds, gameState);
      const danger = this.deps.assessDiscardDanger(candidate, gameState, playerIndex);
      const score = this.priorityScorer.scorePostResponseDiscard({
        compositeScore: projection.compositeScore,
        keepValue,
        waitCount: listening.waitCards.length,
        remainingWaitCount: listening.remainingWaitCount,
        maxRoundScore: listening.maxRoundScore,
        avgHuPoints: listening.avgHuPoints,
        dangerScore: danger.score
      });
      if (score > bestScore) {
        bestScore = score;
        bestDiscard = candidate;
        bestListening = listening.waitCards.length > 0 ? listening : void 0;
        bestEvaluation = projection;
        bestAnalysis = analysis;
        bestDanger = danger;
      }
    }
    return {
      bestScore: Number.isFinite(bestScore) ? bestScore : 0,
      bestDiscard,
      bestListening,
      bestEvaluation,
      bestAnalysis,
      bestDanger
    };
  }
};

// src/ai/ai-analyzer.ts
var DEFAULT_ANALYSIS_CONFIG = {
  discardTopK: 5,
  chiOptionTopK: 3,
  policyMode: "heuristic"
};
var AIAnalyzer = class {
  constructor() {
    this.opponentInference = new OpponentInference();
    this.winRateCalculator = new WinRateCalculator();
    this.strategyEvaluator = new StrategyEvaluator();
    this.explanationEngine = new AIExplanationEngine();
    this.actionEvEvaluator = new ActionEvEvaluator();
    this.handAnalyzer = new HandAnalyzer();
    this.rulesValidator = new RulesValidator();
    this.scoreCalculator = new ScoreCalculator();
    this.listeningCache = /* @__PURE__ */ new Map();
    this.visibleCountsCache = /* @__PURE__ */ new Map();
    this.projectedStateCache = /* @__PURE__ */ new Map();
    this.currentAnalysisConfig = { ...DEFAULT_ANALYSIS_CONFIG };
    this.recommendationGenerator = new AIRecommendationGenerator({
      handAnalyzer: this.handAnalyzer,
      rulesValidator: this.rulesValidator,
      evaluateProjectedState: this.evaluateProjectedState.bind(this),
      evaluateDiscardListening: this.evaluateDiscardListening.bind(this),
      buildDecisionEvidence: this.buildDecisionEvidence.bind(this),
      buildEvBreakdown: this.buildEvBreakdown.bind(this),
      buildTeachingPayload: this.buildTeachingPayload.bind(this),
      buildRecommendationSummary: this.buildRecommendationSummary.bind(this),
      buildDiscardKeyPoints: this.buildDiscardKeyPoints.bind(this),
      getCardConnectionProfile: this.getCardConnectionProfile.bind(this),
      calculateKeepValue: this.calculateKeepValue.bind(this),
      generateDiscardReasoning: this.generateDiscardReasoning.bind(this),
      formatCardCode: this.formatCardCode.bind(this),
      assessDiscardDanger: this.assessDiscardDanger.bind(this)
    });
  }
  formatCardCode(card) {
    return `${card.size === "small" /* SMALL */ ? "S" : "B"}${card.value}`;
  }
  buildListeningCacheKey(handCards, melds) {
    const handSignature = handCards.map((card) => `${card.size}_${card.value}`).sort().join("|");
    const meldSignature = melds.map((meld) => `${meld.type}:${meld.cards.map((card) => `${card.size}_${card.value}`).sort().join(",")}`).sort().join("|");
    return `${handSignature}__${meldSignature}`;
  }
  buildGameStateCacheKey(gameState) {
    return [
      gameState.phase,
      gameState.turnCount,
      gameState.currentPlayerIndex,
      gameState.remainingDeckCards,
      gameState.discardPile?.cards?.length || 0,
      gameState.discardPile?.lastDiscard?.id || "none",
      gameState.pendingCardSource || "none"
    ].join("|");
  }
  buildProjectedStateCacheKey(handCards, melds, discardedCards, gameState) {
    const base = this.buildListeningCacheKey(handCards, melds);
    const discardedSignature = discardedCards.length === 0 ? "none" : discardedCards.slice(-4).map((card) => card.id).join(",");
    const stateSignature2 = gameState ? this.buildGameStateCacheKey(gameState) : "no_state";
    return `${base}__d:${discardedCards.length}:${discardedSignature}__g:${stateSignature2}`;
  }
  createVirtualCard(size, value) {
    const smallRanks = ["\u4E00", "\u4E8C", "\u4E09", "\u56DB", "\u4E94", "\u516D", "\u4E03", "\u516B", "\u4E5D", "\u5341"];
    const bigRanks = ["\u58F9", "\u8D30", "\u53C1", "\u8086", "\u4F0D", "\u9646", "\u67D2", "\u634C", "\u7396", "\u62FE"];
    const isRed = value === 2 || value === 7 || value === 10;
    return {
      id: `analysis_${size}_${value}`,
      rank: size === "small" /* SMALL */ ? smallRanks[value - 1] : bigRanks[value - 1],
      size,
      color: isRed ? "red" /* RED */ : "black" /* BLACK */,
      value,
      isRed
    };
  }
  collectVisibleCardCodeCounts(gameState) {
    const stateKey = this.buildGameStateCacheKey(gameState);
    const cached = this.visibleCountsCache.get(stateKey);
    if (cached) {
      return cached;
    }
    const counts = /* @__PURE__ */ new Map();
    const seenIds = /* @__PURE__ */ new Set();
    const addCard = (card) => {
      if (!card || seenIds.has(card.id)) return;
      seenIds.add(card.id);
      const code = this.formatCardCode(card);
      counts.set(code, (counts.get(code) || 0) + 1);
    };
    for (const player of gameState.players || []) {
      for (const card of player.cards || []) addCard(card);
      for (const meld of player.melds || []) {
        for (const card of meld.cards || []) addCard(card);
      }
    }
    for (const card of gameState.discardPile?.cards || []) addCard(card);
    addCard(gameState.discardPile?.lastDiscard);
    this.visibleCountsCache.set(stateKey, counts);
    return counts;
  }
  evaluateDiscardListening(gameState, handCards, melds) {
    const cacheKey = this.buildListeningCacheKey(handCards, melds);
    const cached = this.listeningCache.get(cacheKey);
    if (cached) {
      return cached;
    }
    const visibleCounts = this.collectVisibleCardCodeCounts(gameState);
    const waitOutcomes = [];
    const currentAnalysis = this.handAnalyzer.analyze(handCards, melds);
    const shouldUseLightweightListening = gameState.phase === "discarding" && (currentAnalysis.stepsToWin || 3) > 1;
    if (shouldUseLightweightListening) {
      const improvementOutcomes = this.evaluateImprovementTiles(handCards, melds, visibleCounts, currentAnalysis);
      const result2 = {
        waitCards: improvementOutcomes.map((item) => item.code),
        remainingWaitCount: improvementOutcomes.reduce((sum, item) => sum + item.remaining, 0),
        maxHuPoints: 0,
        avgHuPoints: 0,
        maxRoundScore: 0,
        avgRoundScore: 0,
        bestMingTangNames: []
      };
      this.listeningCache.set(cacheKey, result2);
      return result2;
    }
    for (const size of ["small" /* SMALL */, "big" /* BIG */]) {
      for (let value = 1; value <= 10; value++) {
        const virtualCard = this.createVirtualCard(size, value);
        const code = this.formatCardCode(virtualCard);
        const remaining = Math.max(0, 4 - (visibleCounts.get(code) || 0));
        if (remaining <= 0) continue;
        if (!this.rulesValidator.canHu(handCards, melds, virtualCard, "draw")) continue;
        const winningHandMelds = this.rulesValidator.findWinningHandMelds([...handCards, virtualCard], melds, virtualCard, "draw");
        if (!winningHandMelds) continue;
        const scoreResult = this.scoreCalculator.calculateTotalScore([...melds, ...winningHandMelds], {
          winType: "self_draw"
        });
        waitOutcomes.push({
          code,
          remaining,
          huPoints: scoreResult.totalHuPoints,
          roundScore: scoreResult.roundScore,
          mingTangNames: (scoreResult.mingtangs || []).map((item) => item.name)
        });
      }
    }
    if (waitOutcomes.length === 0) {
      if (gameState.phase !== "discarding") {
        const result3 = {
          waitCards: [],
          remainingWaitCount: 0,
          maxHuPoints: 0,
          avgHuPoints: 0,
          maxRoundScore: 0,
          avgRoundScore: 0,
          bestMingTangNames: []
        };
        this.listeningCache.set(cacheKey, result3);
        return result3;
      }
      const improvementOutcomes = this.evaluateImprovementTiles(handCards, melds, visibleCounts, currentAnalysis);
      if (improvementOutcomes.length > 0) {
        const result3 = {
          waitCards: improvementOutcomes.map((item) => item.code),
          remainingWaitCount: improvementOutcomes.reduce((sum, item) => sum + item.remaining, 0),
          maxHuPoints: 0,
          avgHuPoints: 0,
          maxRoundScore: 0,
          avgRoundScore: 0,
          bestMingTangNames: []
        };
        this.listeningCache.set(cacheKey, result3);
        return result3;
      }
      const result2 = {
        waitCards: [],
        remainingWaitCount: 0,
        maxHuPoints: 0,
        avgHuPoints: 0,
        maxRoundScore: 0,
        avgRoundScore: 0,
        bestMingTangNames: []
      };
      this.listeningCache.set(cacheKey, result2);
      return result2;
    }
    const totalHu = waitOutcomes.reduce((sum, item) => sum + item.huPoints, 0);
    const totalRoundScore = waitOutcomes.reduce((sum, item) => sum + item.roundScore, 0);
    const bestOutcome = [...waitOutcomes].sort((left, right) => right.roundScore - left.roundScore || right.huPoints - left.huPoints)[0];
    const result = {
      waitCards: waitOutcomes.map((item) => item.code),
      remainingWaitCount: waitOutcomes.reduce((sum, item) => sum + item.remaining, 0),
      maxHuPoints: Math.max(...waitOutcomes.map((item) => item.huPoints)),
      avgHuPoints: totalHu / waitOutcomes.length,
      maxRoundScore: Math.max(...waitOutcomes.map((item) => item.roundScore)),
      avgRoundScore: totalRoundScore / waitOutcomes.length,
      bestMingTangNames: bestOutcome?.mingTangNames || []
    };
    this.listeningCache.set(cacheKey, result);
    return result;
  }
  evaluateImprovementTiles(handCards, melds, visibleCounts, currentAnalysis) {
    const currentStructureScore = this.scoreHandStructure(currentAnalysis);
    const outcomes = [];
    for (const virtualCard of this.listImprovementCandidateTiles(handCards)) {
      const code = this.formatCardCode(virtualCard);
      const remaining = Math.max(0, 4 - (visibleCounts.get(code) || 0));
      if (remaining <= 0) continue;
      const nextAnalysis = this.handAnalyzer.analyze([...handCards, virtualCard], melds);
      const nextStructureScore = this.scoreHandStructure(nextAnalysis);
      const improvementScore = nextStructureScore - currentStructureScore;
      if (improvementScore > 0) {
        outcomes.push({ code, remaining, improvementScore });
      }
    }
    return outcomes.sort((left, right) => right.improvementScore - left.improvementScore || right.remaining - left.remaining).map(({ code, remaining }) => ({ code, remaining }));
  }
  scoreHandStructure(analysis) {
    const meldWeights = {
      quadruple: 4.8,
      triple: 4.2,
      special_2710: 4,
      mixed_size: 3.6,
      sequence: 3,
      pair: 1
    };
    const potentialWeight = (analysis.potentialMelds || []).reduce((sum, meld) => sum + (meldWeights[meld.type] || 0), 0);
    const tingBonus = (analysis.tingCards?.length || 0) * 40;
    const stepPenalty = (analysis.stepsToWin || 3) * 1e3;
    const loosePenalty = (analysis.looseCards?.length || 0) * 36;
    const completenessBonus = (analysis.completeness || 0) * 120;
    return potentialWeight * 25 + tingBonus + completenessBonus - stepPenalty - loosePenalty;
  }
  listImprovementCandidateTiles(handCards) {
    const candidates = /* @__PURE__ */ new Map();
    const addCandidate = (size, value) => {
      if (value < 1 || value > 10) {
        return;
      }
      const card = this.createVirtualCard(size, value);
      candidates.set(this.formatCardCode(card), card);
    };
    for (const card of handCards) {
      addCandidate(card.size, card.value);
      addCandidate(card.size === "small" /* SMALL */ ? "big" /* BIG */ : "small" /* SMALL */, card.value);
      addCandidate(card.size, card.value - 2);
      addCandidate(card.size, card.value - 1);
      addCandidate(card.size, card.value + 1);
      addCandidate(card.size, card.value + 2);
      if ([2, 7, 10].includes(card.value)) {
        addCandidate(card.size, 2);
        addCandidate(card.size, 7);
        addCandidate(card.size, 10);
      }
    }
    return Array.from(candidates.values());
  }
  buildCodeCountMap(cards) {
    const counts = /* @__PURE__ */ new Map();
    for (const card of cards) {
      const code = this.formatCardCode(card);
      counts.set(code, (counts.get(code) || 0) + 1);
    }
    return counts;
  }
  adjustCountMap(counts, code, delta) {
    const next = Math.max(0, (counts.get(code) || 0) + delta);
    if (next === 0) {
      counts.delete(code);
      return;
    }
    counts.set(code, next);
  }
  buildLockedHandContext(handCards) {
    const groupedByCode = /* @__PURE__ */ new Map();
    for (const card of handCards) {
      const code = this.formatCardCode(card);
      if (!groupedByCode.has(code)) {
        groupedByCode.set(code, []);
      }
      groupedByCode.get(code).push(card);
    }
    const lockedCardIds = /* @__PURE__ */ new Set();
    const lockedHandCounts = /* @__PURE__ */ new Map();
    for (const [code, group] of groupedByCode.entries()) {
      if (group.length < 3) {
        continue;
      }
      lockedHandCounts.set(code, group.length);
      for (const card of group) {
        lockedCardIds.add(card.id);
      }
    }
    return { lockedCardIds, lockedHandCounts };
  }
  buildStableMeldCounts(analysis) {
    const counts = /* @__PURE__ */ new Map();
    for (const meld of analysis.potentialMelds || []) {
      if (meld.type === "pair") {
        continue;
      }
      for (const meldCard of meld.cards) {
        const code = this.formatCardCode(meldCard);
        counts.set(code, (counts.get(code) || 0) + 1);
      }
    }
    return counts;
  }
  buildExposedMeldCodeCounts(gameState) {
    const counts = /* @__PURE__ */ new Map();
    for (const player of gameState.players || []) {
      for (const meld of player.melds || []) {
        if (meld.isConcealed) {
          continue;
        }
        for (const meldCard of meld.cards) {
          const code = this.formatCardCode(meldCard);
          counts.set(code, (counts.get(code) || 0) + 1);
        }
      }
    }
    return counts;
  }
  countUsableSupport(code, freeCounts, stableMeldCounts) {
    return Math.max(0, (freeCounts.get(code) || 0) - (stableMeldCounts.get(code) || 0));
  }
  countResponseSequenceOpportunities(card, freeCounts, stableMeldCounts, visibleCounts, exposedMeldCounts) {
    const prefix = card.size === "small" /* SMALL */ ? "S" : "B";
    let liveResponseSequenceCount = 0;
    let liveResponse2710Count = 0;
    let deadResponseSequenceCount = 0;
    let deadResponse2710Count = 0;
    let stableResponseBlockCount = 0;
    let guiResponseCount = 0;
    const applyResponseWindow = (codes, category) => {
      const otherCodes = codes.filter((code) => code !== this.formatCardCode(card));
      const freePartners = otherCodes.filter((code) => (freeCounts.get(code) || 0) > 0);
      if (freePartners.length !== 1) {
        return;
      }
      const partnerCode = freePartners[0];
      const missingCode = otherCodes.find((code) => code !== partnerCode);
      if (!missingCode) {
        return;
      }
      const remaining = this.countRemainingCopies(visibleCounts, missingCode);
      if (remaining <= 0) {
        if (category === "sequence") {
          deadResponseSequenceCount += 1;
        } else {
          deadResponse2710Count += 1;
        }
        return;
      }
      const usableSupport = this.countUsableSupport(partnerCode, freeCounts, stableMeldCounts);
      if (usableSupport <= 0) {
        stableResponseBlockCount += remaining;
        return;
      }
      if (category === "sequence") {
        liveResponseSequenceCount += remaining;
      } else {
        liveResponse2710Count += remaining;
      }
      if ((exposedMeldCounts.get(missingCode) || 0) >= 3) {
        guiResponseCount += remaining;
      }
    };
    for (let start = card.value - 2; start <= card.value; start++) {
      if (start < 1 || start + 2 > 10) {
        continue;
      }
      applyResponseWindow(
        [start, start + 1, start + 2].map((value) => `${prefix}${value}`),
        "sequence"
      );
    }
    if ([2, 7, 10].includes(card.value)) {
      applyResponseWindow([2, 7, 10].map((value) => `${prefix}${value}`), "special_2710");
    }
    return {
      liveResponseSequenceCount,
      liveResponse2710Count,
      deadResponseSequenceCount,
      deadResponse2710Count,
      stableResponseBlockCount,
      guiResponseCount
    };
  }
  listSequenceSupportCodes(card) {
    const codes = /* @__PURE__ */ new Set();
    const prefix = card.size === "small" /* SMALL */ ? "S" : "B";
    for (let start = card.value - 2; start <= card.value; start++) {
      if (start < 1 || start + 2 > 10) {
        continue;
      }
      for (const value of [start, start + 1, start + 2]) {
        if (value !== card.value) {
          codes.add(`${prefix}${value}`);
        }
      }
    }
    return Array.from(codes);
  }
  listSpecialSupportCodes(card) {
    if (![2, 7, 10].includes(card.value)) {
      return [];
    }
    const prefix = card.size === "small" /* SMALL */ ? "S" : "B";
    return [2, 7, 10].filter((value) => value !== card.value).map((value) => `${prefix}${value}`);
  }
  countRemainingCopies(visibleCounts, code) {
    return Math.max(0, 4 - (visibleCounts.get(code) || 0));
  }
  classifyTemplate(requirements, freeCounts, totalCounts) {
    let allFree = true;
    for (const [code, requiredCount] of requirements) {
      const totalCount = totalCounts.get(code) || 0;
      if (totalCount < requiredCount) {
        return "unavailable";
      }
      if ((freeCounts.get(code) || 0) < requiredCount) {
        allFree = false;
      }
    }
    return allFree ? "viable" : "blocked";
  }
  getCardConnectionProfile(card, handCards, melds, gameState) {
    const visibleCounts = this.collectVisibleCardCodeCounts(gameState);
    const sameCode = this.formatCardCode(card);
    const mixedCode = `${card.size === "small" /* SMALL */ ? "B" : "S"}${card.value}`;
    const analysis = this.handAnalyzer.analyze(handCards, melds);
    const { lockedCardIds, lockedHandCounts } = this.buildLockedHandContext(handCards);
    const lockedSupportCounts = new Map(lockedHandCounts);
    const stableMeldCounts = this.buildStableMeldCounts(analysis);
    const exposedMeldCounts = this.buildExposedMeldCodeCounts(gameState);
    const freeCounts = this.buildCodeCountMap(handCards);
    for (const [code, count] of lockedHandCounts.entries()) {
      this.adjustCountMap(freeCounts, code, -count);
    }
    const currentLocked = lockedCardIds.has(card.id);
    if (currentLocked) {
      this.adjustCountMap(lockedSupportCounts, sameCode, -1);
    } else {
      this.adjustCountMap(freeCounts, sameCode, -1);
    }
    const totalCounts = new Map(freeCounts);
    for (const [code, count] of lockedSupportCounts.entries()) {
      this.adjustCountMap(totalCounts, code, count);
    }
    const sequenceSupportCodes = this.listSequenceSupportCodes(card);
    const specialSupportCodes = this.listSpecialSupportCodes(card);
    const supportCodes = /* @__PURE__ */ new Set([sameCode, mixedCode, ...sequenceSupportCodes, ...specialSupportCodes]);
    let viablePairTemplates = 0;
    let viableMixedTemplates = 0;
    let viableSequenceTemplates = 0;
    let viable2710Templates = 0;
    let blockedPairTemplates = 0;
    let blockedMixedTemplates = 0;
    let blockedSequenceTemplates = 0;
    let blocked2710Templates = 0;
    const applyTemplateResult = (templateType, requirements) => {
      const result = this.classifyTemplate(requirements, freeCounts, totalCounts);
      if (result === "unavailable") {
        return;
      }
      const isViable = result === "viable";
      if (templateType === "pair") {
        viablePairTemplates += isViable ? 1 : 0;
        blockedPairTemplates += isViable ? 0 : 1;
      } else if (templateType === "mixed") {
        viableMixedTemplates += isViable ? 1 : 0;
        blockedMixedTemplates += isViable ? 0 : 1;
      } else if (templateType === "sequence") {
        viableSequenceTemplates += isViable ? 1 : 0;
        blockedSequenceTemplates += isViable ? 0 : 1;
      } else {
        viable2710Templates += isViable ? 1 : 0;
        blocked2710Templates += isViable ? 0 : 1;
      }
    };
    applyTemplateResult("pair", [[sameCode, 1]]);
    applyTemplateResult("mixed", [[sameCode, 1], [mixedCode, 1]]);
    applyTemplateResult("mixed", [[mixedCode, 2]]);
    const prefix = card.size === "small" /* SMALL */ ? "S" : "B";
    for (let start = card.value - 2; start <= card.value; start++) {
      if (start < 1 || start + 2 > 10) {
        continue;
      }
      const requirements = [start, start + 1, start + 2].filter((value) => value !== card.value).map((value) => [`${prefix}${value}`, 1]);
      applyTemplateResult("sequence", requirements);
    }
    if ([2, 7, 10].includes(card.value)) {
      const requirements = [2, 7, 10].filter((value) => value !== card.value).map((value) => [`${prefix}${value}`, 1]);
      applyTemplateResult("special_2710", requirements);
    }
    const sameCards = freeCounts.get(sameCode) || 0;
    const mixedSizeCards = freeCounts.get(mixedCode) || 0;
    const sequenceLinks = sequenceSupportCodes.reduce((sum, code) => sum + (freeCounts.get(code) || 0), 0);
    const specialLinks = specialSupportCodes.reduce((sum, code) => sum + (freeCounts.get(code) || 0), 0);
    const freeSupportCount = Array.from(supportCodes).reduce((sum, code) => sum + (freeCounts.get(code) || 0), 0);
    const lockedSupportCount = Array.from(supportCodes).reduce((sum, code) => sum + (lockedSupportCounts.get(code) || 0), 0);
    const responseOpportunities = this.countResponseSequenceOpportunities(
      card,
      freeCounts,
      stableMeldCounts,
      visibleCounts,
      exposedMeldCounts
    );
    const liveSameCardCount = this.countRemainingCopies(visibleCounts, sameCode);
    const liveMixedCardCount = this.countRemainingCopies(visibleCounts, mixedCode);
    const liveSequenceCount = sequenceSupportCodes.reduce((sum, code) => sum + this.countRemainingCopies(visibleCounts, code), 0);
    const liveSpecialCount = specialSupportCodes.reduce((sum, code) => sum + this.countRemainingCopies(visibleCounts, code), 0);
    const totalLiveSupport = Array.from(supportCodes).reduce((sum, code) => sum + this.countRemainingCopies(visibleCounts, code), 0) + responseOpportunities.liveResponseSequenceCount + responseOpportunities.liveResponse2710Count;
    const totalTemplateCount = viablePairTemplates + viableMixedTemplates + viableSequenceTemplates + viable2710Templates;
    const blockedTemplateCount = blockedPairTemplates + blockedMixedTemplates + blockedSequenceTemplates + blocked2710Templates;
    return {
      isLocked: currentLocked,
      sameCards,
      mixedSizeCards,
      sequenceLinks,
      specialLinks,
      ...responseOpportunities,
      viablePairTemplates,
      viableMixedTemplates,
      viableSequenceTemplates,
      viable2710Templates,
      blockedPairTemplates,
      blockedMixedTemplates,
      blockedSequenceTemplates,
      blocked2710Templates,
      freeSupportCount,
      lockedSupportCount,
      totalTemplateCount,
      blockedTemplateCount,
      liveSameCardCount,
      liveMixedCardCount,
      liveSequenceCount,
      liveSpecialCount,
      totalLiveSupport,
      isIsolated: !currentLocked && totalTemplateCount === 0,
      isNearlyDead: !currentLocked && totalTemplateCount === 0 && (blockedTemplateCount > 0 || totalLiveSupport <= 4)
    };
  }
  assessDiscardDanger(card, gameState, playerIndex) {
    const visibleCounts = this.collectVisibleCardCodeCounts(gameState);
    const code = this.formatCardCode(card);
    const visibleSame = visibleCounts.get(code) || 0;
    const liveSame = Math.max(0, 4 - visibleSame);
    const discardCount = (gameState.discardPile?.cards || []).filter((item) => item.value === card.value && item.size === card.size).length;
    const aggressiveOpponents = gameState.players.filter((player, index) => index !== playerIndex && ((player.cards?.length || 0) <= 6 || (player.melds?.length || 0) >= 3 || !!player.isBao)).length;
    let score = 24;
    score += card.isRed ? 22 : 0;
    score += discardCount === 0 ? 14 : Math.max(0, 8 - discardCount * 4);
    score += liveSame * 5;
    score += aggressiveOpponents * 6;
    score += gameState.remainingDeckCards <= 10 ? 8 : 0;
    score += gameState.turnCount >= 12 ? 6 : 0;
    const label = score >= 70 ? "high" : score >= 45 ? "medium" : "low";
    const summary = label === "high" ? "\u8FD9\u5F20\u504F\u751F\uFF0C\u4E14\u5BF9\u624B\u6210\u724C\u538B\u529B\u5927\uFF0C\u6253\u51FA\u53BB\u6709\u653E\u70AE\u98CE\u9669" : label === "medium" ? "\u8FD9\u5F20\u8FD8\u4E0D\u7B97\u7EDD\u5BF9\u5B89\u5168\uFF0C\u82E5\u6CA1\u6709\u660E\u663E\u8FDB\u653B\u6536\u76CA\uFF0C\u8981\u7559\u610F\u540E\u624B" : "\u8FD9\u5F20\u76F8\u5BF9\u66F4\u719F\uFF0C\u6253\u51FA\u53BB\u7684\u5931\u8BEF\u6210\u672C\u8F83\u4F4E";
    return { score: Math.min(100, score), label, summary };
  }
  getStagePressure(gameState) {
    const turnPressure = Math.min(1, gameState.turnCount / 18);
    const deckPressure = gameState.remainingDeckCards <= 0 ? 1 : Math.max(0, 1 - Math.min(gameState.remainingDeckCards, 20) / 20);
    return Math.min(1, turnPressure * 0.55 + deckPressure * 0.45);
  }
  buildProjectedSummary(posture, speedScore, scorePotential, defensePressure) {
    if (posture === "attack") {
      return scorePotential >= 10 ? "\u8FD9\u624B\u66F4\u9002\u5408\u4E3B\u52A8\u63D0\u901F\uFF0C\u540C\u65F6\u4FDD\u7559\u505A\u5927\u7A7A\u95F4" : "\u8FD9\u624B\u66F4\u9002\u5408\u4E3B\u52A8\u62A2\u8282\u594F\uFF0C\u5148\u628A\u542C\u53E3\u548C\u8FDB\u5F20\u505A\u51FA\u6765";
    }
    if (posture === "defense") {
      return defensePressure >= 0.65 ? "\u5F53\u524D\u9632\u5B88\u538B\u529B\u504F\u5927\uFF0C\u5148\u5904\u7406\u5371\u9669\u5F20\u548C\u4F4E\u6548\u7387\u724C\u66F4\u7A33" : "\u8FD9\u624B\u9700\u8981\u7A33\u7740\u6574\u7406\uFF0C\u522B\u4E3A\u4E86\u5C0F\u5229\u628A\u81EA\u5DF1\u9001\u8FDB\u88AB\u52A8\u5C40";
    }
    return speedScore >= 0.55 ? "\u8FD9\u624B\u5C5E\u4E8E\u8FB9\u6574\u7406\u8FB9\u63D0\u901F\u7684\u5747\u8861\u5C40\u9762" : "\u8FD9\u624B\u5148\u7A33\u4F4F\u4E3B\u5E72\uFF0C\u518D\u770B\u540E\u7EED\u8F6C\u653B\u8FD8\u662F\u8F6C\u5B88";
  }
  buildRecommendationSummary(action, posture, reasoning) {
    if (action === "discard") {
      return posture === "attack" ? "\u8FD9\u5F20\u662F\u5F53\u524D\u6700\u9002\u5408\u7684\u63D0\u901F\u820D\u5F20" : posture === "defense" ? "\u8FD9\u5F20\u662F\u5F53\u524D\u6700\u9002\u5408\u5148\u5904\u7406\u7684\u98CE\u9669\u724C" : "\u8FD9\u5F20\u6700\u4E0D\u4F24\u4E3B\u5E72\uFF0C\u9002\u5408\u5F53\u524D\u6574\u7406\u8282\u594F";
    }
    if (action === "chi" || action === "peng" || action === "zhao") {
      return reasoning.length > 24 ? reasoning.slice(0, 24) : reasoning;
    }
    if (action === "hu") {
      return "\u6536\u76CA\u5DF2\u7ECF\u6210\u719F\uFF0C\u5148\u628A\u5206\u6570\u7A33\u7A33\u6536\u4E0B";
    }
    if (action === "pass") {
      return "\u8FD9\u4E00\u624B\u5148\u8FC7\uFF0C\u66F4\u80FD\u4FDD\u4F4F\u540E\u7EED\u5F39\u6027";
    }
    return reasoning;
  }
  buildDiscardKeyPoints(listening, profile, danger, evaluation) {
    const points = [];
    points.push(evaluation.summary);
    if (listening.waitCards.length > 0) {
      points.push(`\u6253\u5B8C\u540E\u6709\u673A\u4F1A\u542C ${listening.waitCards.join("\u3001")}\uFF0C\u8FDB\u5F20\u603B\u91CF\u7EA6 ${listening.remainingWaitCount} \u5F20`);
    }
    if (profile.isIsolated) {
      points.push(profile.blockedTemplateCount > 0 ? "\u5B83\u770B\u4F3C\u8FD8\u80FD\u8FDE\u5F20\uFF0C\u4F46\u5173\u952E\u652F\u6491\u5DF2\u88AB\u9501\u6B7B\uFF0C\u7EE7\u7EED\u7559\u7740\u591A\u534A\u53EA\u662F\u4F2A\u6D3B\u5F20" : "\u5B83\u57FA\u672C\u662F\u5B64\u5F20\uFF0C\u7EE7\u7EED\u7559\u7740\u5F88\u96BE\u8F6C\u5316\u6210\u6709\u6548\u724C\u7EC4");
    } else if (profile.isNearlyDead) {
      points.push("\u8FD9\u5F20\u6D3B\u5F20\u5F88\u5C11\uFF0C\u540E\u7EED\u5927\u6982\u7387\u53EA\u662F\u7EE7\u7EED\u62D6\u624B");
    }
    points.push(danger.summary);
    return points.slice(0, 3);
  }
  determinePosture(gameState, handCards, melds, listening, strategyScore, riskLevel) {
    const analysis = this.handAnalyzer.analyze(handCards, melds);
    const stagePressure = this.getStagePressure(gameState);
    if (analysis.canWin || listening.waitCards.length > 0 || (analysis.stepsToWin || 3) <= 1 || strategyScore >= 68 && riskLevel <= 58) {
      return "attack";
    }
    if (riskLevel >= 66 || (analysis.looseCards.length || 0) >= Math.max(4, Math.ceil(handCards.length * 0.45)) && stagePressure >= 0.45) {
      return "defense";
    }
    return "balance";
  }
  buildDecisionEvidence(params) {
    const { evaluation, listening, danger, tempoGain, flexibility, breakdown, extraSignals = [] } = params;
    const evidence = {
      speedScore: evaluation?.speedScore,
      ukeireCount: listening?.remainingWaitCount,
      scorePotential: evaluation?.scorePotential,
      dangerScore: danger?.score,
      waitCount: listening?.waitCards.length,
      maxHuPoints: listening?.maxHuPoints,
      maxRoundScore: listening?.maxRoundScore,
      tempoGain,
      flexibility,
      breakdown,
      tags: [],
      signals: []
    };
    if ((evaluation?.speedScore || 0) >= 0.55 || (tempoGain || 0) >= 1) {
      evidence.tags?.push("speed");
      evidence.signals?.push(`\u8FD9\u6B65\u7684\u63D0\u901F\u6536\u76CA\u660E\u663E\uFF0C\u5F53\u524D\u901F\u5EA6\u8BC4\u5206\u7EA6 ${Math.round((evaluation?.speedScore || 0) * 100)}%`);
    }
    if ((listening?.remainingWaitCount || 0) > 0) {
      evidence.tags?.push("ukeire");
      evidence.signals?.push(`\u540E\u7EED\u6709\u6548\u8FDB\u5F20\u603B\u91CF\u7EA6 ${listening?.remainingWaitCount || 0} \u5F20\uFF0C\u542C\u53E3\u6570 ${listening?.waitCards.length || 0}`);
    }
    if ((evaluation?.scorePotential || 0) >= 10 || (listening?.maxRoundScore || 0) >= 10) {
      evidence.tags?.push("score");
      evidence.signals?.push(`\u8FD9\u6761\u8DEF\u7EBF\u7684\u6700\u9AD8\u5355\u5C40\u5206\u6F5C\u529B\u7EA6 ${Math.max(evaluation?.scorePotential || 0, listening?.maxRoundScore || 0)}`);
    }
    if ((danger?.score || 0) >= 45) {
      evidence.tags?.push("risk");
      evidence.signals?.push(`\u5F53\u524D\u5371\u9669\u5206\u7EA6 ${danger?.score || 0}\uFF0C\u9700\u8981\u517C\u987E\u5B89\u5168\u5904\u7406`);
    }
    if ((flexibility || 0) >= 0.45) {
      evidence.tags?.push("flexibility");
    }
    if ((evaluation?.speedScore || 0) >= 0.4 || (flexibility || 0) >= 0.3) {
      evidence.tags?.push("shape");
    }
    evidence.tags = Array.from(new Set(evidence.tags));
    evidence.signals = Array.from(/* @__PURE__ */ new Set([...evidence.signals || [], ...extraSignals])).slice(0, 4);
    return evidence;
  }
  buildEvBreakdown(params) {
    return this.actionEvEvaluator.evaluate({
      gameState: params.gameState,
      playerIndex: params.playerIndex,
      beforeSteps: params.beforeSteps,
      afterSteps: params.afterSteps,
      beforeUkeire: params.beforeUkeire,
      afterUkeire: params.afterUkeire,
      beforeScorePotential: params.beforeScorePotential,
      afterScorePotential: params.afterScorePotential,
      dangerScore: params.dangerScore
    });
  }
  buildTeachingPayload(action, posture, evidence, fallbackSummary, fallbackPoints) {
    const explanation = this.explanationEngine.buildExplanation({
      action,
      posture,
      evidence,
      fallbackSummary,
      fallbackPoints
    });
    return {
      summary: explanation.summary,
      keyPoints: explanation.keyPoints,
      evidence
    };
  }
  matchRecommendationToAction(action, recommendations) {
    const actionIds = (action.cards || []).map((card) => card.id).sort();
    const matchesActionOption = (recommendation) => {
      const recommendationCards = recommendation.card ? [recommendation.card] : recommendation.meldCards || [];
      const recommendationIds = recommendationCards.map((card) => card.id).sort();
      if (actionIds.length === recommendationIds.length && actionIds.every((id, index) => id === recommendationIds[index])) {
        return true;
      }
      if (action.type === "chi" && action.chiOptions?.length) {
        return action.chiOptions.some((option) => {
          const optionIds = option.selectedCards.map((card) => card.id).sort();
          return optionIds.length === recommendationIds.length && optionIds.every((id, index) => id === recommendationIds[index]);
        });
      }
      if (action.type === "hu" && action.huOptions?.length) {
        return action.huOptions.some((option) => {
          const optionIds = option.selectedCards.map((card) => card.id).sort();
          return optionIds.length === recommendationIds.length && optionIds.every((id, index) => id === recommendationIds[index]);
        });
      }
      return false;
    };
    const exact = recommendations.find((recommendation) => {
      if (recommendation.action !== action.type) return false;
      if (actionIds.length === 0 && !(action.type === "chi" || action.type === "hu")) {
        const recommendationCards = recommendation.card ? [recommendation.card] : recommendation.meldCards || [];
        const recommendationIds = recommendationCards.map((card) => card.id).sort();
        if (recommendationIds.length === 0) {
          return true;
        }
      }
      if ((action.type === "chi" || action.type === "hu") && matchesActionOption(recommendation)) {
        return true;
      }
      return matchesActionOption(recommendation);
    });
    if (exact) return exact;
    if (actionIds.length > 0) {
      return void 0;
    }
    return recommendations.find((recommendation) => recommendation.action === action.type);
  }
  fallbackActionScore(action) {
    const baseByType = {
      hu: 100,
      zhao: 78,
      peng: 64,
      chi: 50,
      discard: 46,
      draw: 12,
      pass: 24,
      bao: 70,
      pass_bao: 18
    };
    return (baseByType[action.type] || 0) + (action.isMandatory ? 1e3 : 0);
  }
  buildRankedActions(availableActions, recommendations) {
    const hasAnalyzedRecommendations = recommendations.length > 0;
    return availableActions.map((action) => {
      const recommendation = this.matchRecommendationToAction(action, recommendations);
      const score = action.isMandatory ? 1e3 + (recommendation?.priority || 0) : recommendation ? recommendation.priority : this.fallbackActionScore(action) - (hasAnalyzedRecommendations ? 100 : 0);
      return {
        availableAction: action,
        score,
        recommendation,
        summary: recommendation?.summary || recommendation?.reasoning || action.description,
        evidence: recommendation?.evidence
      };
    }).sort((left, right) => right.score - left.score);
  }
  async analyze(gameState, playerIndex, _config = {}) {
    this.listeningCache.clear();
    this.visibleCountsCache.clear();
    this.projectedStateCache.clear();
    this.currentAnalysisConfig = {
      ...DEFAULT_ANALYSIS_CONFIG,
      ..._config
    };
    const player = gameState.players[playerIndex];
    if (!player) {
      throw new Error(`Player at index ${playerIndex} not found`);
    }
    const handCards = player.cards;
    const melds = player.melds;
    const knownCards = this.collectKnownCards(gameState, playerIndex);
    const winRate = this.winRateCalculator.calculateHeuristicWinRate(handCards, melds);
    const discardedCards = gameState.discardPile?.cards || [];
    const strategy = this.strategyEvaluator.evaluate(handCards, melds, discardedCards);
    const opponentInferences = gameState.players.filter((_, index) => index !== playerIndex).map((opponent) => this.opponentInference.inferOpponentHands(opponent.playerId, knownCards, discardedCards, opponent.melds));
    const recommendations = this.generateRecommendations(gameState, playerIndex, handCards, melds, knownCards);
    const rankedActions = this.buildRankedActions(gameState.availableActions || [], recommendations);
    const topReasoning = recommendations[0]?.summary ? [recommendations[0].summary, ...recommendations[0].keyPoints || []] : recommendations[0]?.reasoning ? [recommendations[0].reasoning] : [];
    return {
      winRate,
      strategy,
      opponentInferences,
      recommendations,
      rankedActions,
      handStrength: strategy.handStrength,
      reasoning: [...strategy.suggestions || [], ...topReasoning].join("\uFF1B")
    };
  }
  collectKnownCards(gameState, playerIndex) {
    const knownCards = /* @__PURE__ */ new Set();
    const player = gameState.players[playerIndex];
    for (const card of player.cards) knownCards.add(card.id);
    for (const currentPlayer of gameState.players) {
      for (const meld of currentPlayer.melds) {
        if (!meld.isConcealed) {
          for (const card of meld.cards) knownCards.add(card.id);
        }
      }
    }
    for (const card of gameState.discardPile?.cards || []) knownCards.add(card.id);
    return knownCards;
  }
  generateRecommendations(gameState, playerIndex, handCards, melds, knownCards) {
    void knownCards;
    return this.recommendationGenerator.generateRecommendations(gameState, playerIndex, handCards, melds, {
      discardTopK: this.currentAnalysisConfig.discardTopK ?? DEFAULT_ANALYSIS_CONFIG.discardTopK,
      chiOptionTopK: this.currentAnalysisConfig.chiOptionTopK ?? DEFAULT_ANALYSIS_CONFIG.chiOptionTopK,
      policyMode: this.currentAnalysisConfig.policyMode ?? DEFAULT_ANALYSIS_CONFIG.policyMode
    });
  }
  evaluateProjectedState(handCards, melds, discardedCards, gameState) {
    const cacheKey = this.buildProjectedStateCacheKey(handCards, melds, discardedCards, gameState);
    const cached = this.projectedStateCache.get(cacheKey);
    if (cached) {
      return cached;
    }
    const strategy = this.strategyEvaluator.evaluate(handCards, melds, discardedCards);
    const handAnalysis = this.handAnalyzer.analyze(handCards, melds);
    const winRate = this.winRateCalculator.calculateHeuristicWinRate(handCards, melds).currentWinRate;
    const listening = gameState ? this.evaluateDiscardListening(gameState, handCards, melds) : { waitCards: [], remainingWaitCount: 0, maxHuPoints: 0, avgHuPoints: 0, maxRoundScore: 0, avgRoundScore: 0, bestMingTangNames: [] };
    const scoreSnapshot = this.scoreCalculator.calculateTotalScore(melds);
    const speedScore = Math.max(0, 1 - ((handAnalysis.stepsToWin || 3) - 1) * 0.25) + Math.min(0.35, handAnalysis.tingCards.length * 0.08);
    const scorePotential = Math.max(scoreSnapshot.roundScore, listening.maxRoundScore, (handAnalysis.totalHuPoints || 0) + listening.bestMingTangNames.length * 2);
    const defensePressure = Math.min(1, (strategy.riskLevel || 0) / 100 + ((gameState?.remainingDeckCards || 20) <= 10 ? 0.12 : 0));
    const expectedScore = Math.round(Math.max(scoreSnapshot.roundScore, listening.maxRoundScore, (handAnalysis.totalHuPoints || 0) + handAnalysis.tingCards.length * 2));
    const posture = gameState ? this.determinePosture(gameState, handCards, melds, listening, strategy.overallScore, strategy.riskLevel || 0) : "balance";
    const compositeScore = strategy.overallScore * 0.34 + winRate * 100 * 0.16 + speedScore * 22 + scorePotential * 2.2 + handAnalysis.tingCards.length * 5 + (handAnalysis.completeness || 0) * 16 + listening.remainingWaitCount * 0.85 - defensePressure * 18;
    const confidence = Math.max(0.4, Math.min(
      0.96,
      0.45 + Math.min(0.18, speedScore * 0.18) + Math.min(0.16, winRate * 0.2) + Math.min(0.1, listening.waitCards.length > 0 ? 0.1 : 0) - Math.min(0.12, defensePressure * 0.12)
    ));
    const summary = this.buildProjectedSummary(posture, speedScore, scorePotential, defensePressure);
    const result = {
      winRate,
      expectedScore,
      compositeScore,
      posture,
      speedScore,
      scorePotential,
      defensePressure,
      confidence,
      summary
    };
    this.projectedStateCache.set(cacheKey, result);
    return result;
  }
  calculateKeepValue(card, handCards, melds, gameState) {
    const profile = this.getCardConnectionProfile(card, handCards, melds, gameState);
    if (profile.isLocked) {
      return 48 + profile.lockedSupportCount * 2;
    }
    const responseLinkValue = profile.liveResponseSequenceCount * 2.8 + profile.liveResponse2710Count * 3.2 + profile.guiResponseCount * 2.4;
    const deadRoutePenalty = profile.deadResponseSequenceCount * 5.4 + profile.deadResponse2710Count * 4.8 + profile.stableResponseBlockCount * 1.2;
    if (profile.isIsolated) {
      return (card.isRed ? 2 : 0) + Math.min(1.8, profile.liveSameCardCount * 0.18 + profile.liveMixedCardCount * 0.1 + profile.liveSequenceCount * 0.03) + responseLinkValue - Math.min(1.2, profile.blockedTemplateCount * 0.4) - deadRoutePenalty;
    }
    const currentLinkValue = profile.viablePairTemplates * 12 + profile.viableMixedTemplates * 7.5 + profile.viableSequenceTemplates * 5.2 + profile.viable2710Templates * 6.2;
    const futureLinkValue = (profile.viablePairTemplates > 0 ? profile.liveSameCardCount * 1.4 : profile.liveSameCardCount * 0.25) + (profile.viableMixedTemplates > 0 ? profile.liveMixedCardCount * 0.9 : profile.liveMixedCardCount * 0.15) + (profile.viableSequenceTemplates > 0 ? profile.liveSequenceCount * 0.4 : profile.liveSequenceCount * 0.08) + (profile.viable2710Templates > 0 ? profile.liveSpecialCount * 0.7 : profile.liveSpecialCount * 0.15);
    const bridgeKeepBonus = (profile.viableSequenceTemplates >= 2 ? 10 : 0) + (profile.viable2710Templates > 0 ? 8 : 0) + (profile.viablePairTemplates > 0 ? 6 : 0) + (profile.liveResponseSequenceCount >= 4 ? 9 : profile.liveResponseSequenceCount > 0 ? 4 : 0) + (profile.liveResponse2710Count > 0 ? 5 : 0) + (profile.guiResponseCount > 0 ? 7 : 0);
    const pseudoLivePenalty = this.calculatePseudoLivePenalty(card, handCards, profile);
    const stalePenalty = profile.isNearlyDead ? 3 : 0;
    return currentLinkValue + futureLinkValue + bridgeKeepBonus + responseLinkValue + (card.isRed ? 3 : 0) - pseudoLivePenalty - stalePenalty - deadRoutePenalty;
  }
  calculatePseudoLivePenalty(card, handCards, profile) {
    void card;
    void handCards;
    if (profile.totalTemplateCount > 0 && (profile.viablePairTemplates > 0 || profile.viableMixedTemplates > 0)) {
      return 0;
    }
    let penalty = 0;
    if (profile.blockedSequenceTemplates > 0) {
      penalty += 18 + profile.blockedSequenceTemplates * 8;
    }
    if (profile.blocked2710Templates > 0) {
      penalty += 10 + profile.blocked2710Templates * 6;
    }
    if (profile.blockedMixedTemplates > 0 && profile.viablePairTemplates === 0) {
      penalty += 8;
    }
    if (profile.lockedSupportCount >= 2) {
      penalty += Math.min(12, profile.lockedSupportCount * 2);
    }
    if (profile.deadResponseSequenceCount > 0) {
      penalty += profile.deadResponseSequenceCount * 6;
    }
    if (profile.stableResponseBlockCount > 0 && profile.liveResponseSequenceCount + profile.liveResponse2710Count === 0) {
      penalty += Math.min(10, profile.stableResponseBlockCount * 0.8);
    }
    return penalty;
  }
  generateDiscardReasoning(card, evaluation, keepValue, listening, profile, danger) {
    const reasons = [];
    reasons.push(card.isRed ? `\u5EFA\u8BAE\u5148\u5904\u7406 ${card.rank}\uFF0C\u8FD9\u662F\u4E00\u5F20\u7EA2\u724C\uFF0C\u7559\u7740\u867D\u6709\u756A\u6570\u7A7A\u95F4\uFF0C\u4F46\u5F53\u524D\u5F03\u5B83\u7684\u7EFC\u5408\u635F\u5931\u66F4\u5C0F` : `\u5EFA\u8BAE\u5148\u51FA${card.size === "small" ? "\u5C0F" : "\u5927"}${card.rank}`);
    if (evaluation.posture === "attack" && listening.waitCards.length > 0) {
      reasons.push(`\u8FD9\u6B65\u504F\u8FDB\u653B\uFF0C\u6253\u5B8C\u540E\u53EF\u542C ${listening.waitCards.join("\u3001")}\uFF0C\u5927\u7EA6\u8FD8\u6709 ${listening.remainingWaitCount} \u5F20\u8FDB\u5F20\uFF0C\u6700\u9AD8\u5355\u5C40\u5206\u53EF\u505A\u5230 ${listening.maxRoundScore} \u5206`);
    } else if (evaluation.posture === "defense") {
      reasons.push("\u8FD9\u6B65\u66F4\u504F\u9632\u5B88\uFF0C\u5148\u628A\u4F4E\u6548\u7387\u724C\u548C\u5371\u9669\u751F\u5F20\u5904\u7406\u6389\uFF0C\u907F\u514D\u540E\u9762\u88AB\u8FEB\u653E\u70AE");
    } else {
      reasons.push("\u8FD9\u6B65\u5C5E\u4E8E\u7A33\u624B\u6574\u7406\uFF0C\u76EE\u6807\u662F\u8BA9\u540E\u9762\u7684\u642D\u5B50\u548C\u542C\u53E3\u90FD\u66F4\u987A");
    }
    if (profile.isIsolated) {
      reasons.push(profile.blockedTemplateCount > 0 ? "\u8FD9\u5F20\u770B\u4F3C\u8FD8\u6709\u642D\u5B50\uFF0C\u4F46\u5173\u952E\u652F\u6491\u5176\u5B9E\u5DF2\u7ECF\u88AB\u9501\u6B7B\uFF0C\u5C5E\u4E8E\u5178\u578B\u4F2A\u6D3B\u5F20\uFF0C\u4F18\u5148\u5904\u7406\u66F4\u7A33" : "\u8FD9\u5F20\u57FA\u672C\u662F\u5B64\u5F20\uFF0C\u5DF2\u7ECF\u8FDB\u5165\u4F18\u5148\u6E05\u7406\u961F\u5217\uFF0C\u5148\u5904\u7406\u5B83\u80FD\u5C3D\u91CF\u4FDD\u4F4F\u5176\u4ED6\u66F4\u6709\u8FDB\u5F20\u4EF7\u503C\u7684\u4E3B\u5E72");
    } else if (profile.guiResponseCount > 0) {
      reasons.push("\u5B83\u8FD8\u4FDD\u7559\u4E86\u5403\u5F20\u4E0E\u5F52\u7684\u53CC\u91CD\u4EF7\u503C\uFF0C\u8FC7\u65E9\u62C6\u6389\u4F1A\u540C\u65F6\u635F\u5931\u8FDB\u5F20\u548C\u540D\u5802\u7A7A\u95F4");
    } else if (profile.isNearlyDead) {
      reasons.push("\u8FD9\u5F20\u8854\u63A5\u5DF2\u7ECF\u5F88\u5F31\uFF0C\u6D3B\u5F20\u4E0D\u591A\uFF0C\u7EE7\u7EED\u7559\u7740\u5927\u591A\u662F\u62D6\u624B");
    } else if (profile.deadResponseSequenceCount + profile.deadResponse2710Count > 0 && profile.liveResponseSequenceCount + profile.liveResponse2710Count === 0) {
      reasons.push("\u5B83\u8868\u9762\u4E0A\u50CF\u80FD\u7EE7\u7EED\u8FDE\u5F20\uFF0C\u4F46\u5173\u952E\u8865\u5F20\u5DF2\u7ECF\u89C1\u5149\u89C1\u5C3D\uFF0C\u7EE7\u7EED\u7559\u7740\u591A\u534A\u53EA\u662F\u6B7B\u8DEF");
    } else if (profile.mixedSizeCards > 0 && profile.sequenceLinks === 0 && profile.sameCards === 0) {
      reasons.push("\u5B83\u73B0\u5728\u4E3B\u8981\u53EA\u5269\u5927\u5C0F\u642D\u7684\u53EF\u80FD\uFF0C\u6210\u7EC4\u6548\u7387\u504F\u4F4E");
    } else if (keepValue <= 8) {
      reasons.push("\u5B83\u548C\u4E3B\u5E72\u8054\u52A8\u5C11\uFF0C\u5148\u820D\u5F03\u5BF9\u6574\u4F53\u4F24\u5BB3\u6700\u5C0F");
    } else {
      reasons.push("\u867D\u7136\u5B83\u4E5F\u80FD\u914D\u724C\uFF0C\u4F46\u548C\u5176\u4ED6\u5019\u9009\u6BD4\u8D77\u6765\uFF0C\u5148\u51FA\u5B83\u66F4\u4E0D\u4F24\u4E3B\u7ED3\u6784");
    }
    if (listening.bestMingTangNames.length > 0) {
      reasons.push(`\u540E\u7EED\u82E5\u8FDB\u5F20\u987A\u5229\uFF0C\u8FD8\u6709\u673A\u4F1A\u5E26\u51FA ${listening.bestMingTangNames.join("\u3001")} \u8FD9\u6837\u7684\u540D\u5802\u7A7A\u95F4`);
    }
    reasons.push(danger.summary);
    return reasons.join("\uFF0C");
  }
};

// src/ai/ai-player-agent.ts
var AIPlayerAgent = class {
  constructor(playerId, options = {}) {
    this.playerId = playerId;
    this.mode = options.mode ?? "learned";
    this.aiAnalyzer = options.analyzer ?? new AIAnalyzer();
    this.handAnalyzer = options.handAnalyzer ?? new HandAnalyzer();
    this.analysisConfig = {
      discardTopK: options.analysisConfig?.discardTopK,
      chiOptionTopK: options.analysisConfig?.chiOptionTopK
    };
  }
  formatCardCode(card) {
    if (!card) return "";
    return `${card.size === "small" ? "S" : "B"}${card.value}`;
  }
  formatCards(cards) {
    if (!cards || cards.length === 0) return void 0;
    return cards.map((card) => this.formatCardCode(card));
  }
  summarizeDecisionSource(source, analysis) {
    switch (source) {
      case "explicit_hu":
        return "\u663E\u5F0F\u80E1\u724C\u53EF\u6267\u884C\uFF0C\u76F4\u63A5\u6536\u5206\u3002";
      case "mandatory":
        return "\u547D\u4E2D\u5F3A\u5236\u52A8\u4F5C\uFF0C\u4F18\u5148\u6267\u884C\u3002";
      case "analysis_top":
        return analysis?.recommendations?.[0]?.reasoning || "\u6309\u7EFC\u5408\u8BC4\u4F30\u9009\u62E9\u6700\u4F18\u5408\u6CD5\u52A8\u4F5C\u3002";
      case "best_legal_discard":
        return "\u5728\u5408\u6CD5\u5F03\u724C\u4E2D\u9009\u62E9\u635F\u5931\u6700\u5C0F\u65B9\u6848\u3002";
      case "meld_priority":
        return "\u6309\u54CD\u5E94\u4F18\u5148\u7EA7\u9009\u62E9\u53EF\u6267\u884C\u526F\u9732\u52A8\u4F5C\u3002";
      case "default_available":
        return "\u6267\u884C\u5F53\u524D\u53EF\u7528\u7684\u7A33\u5B9A\u9ED8\u8BA4\u52A8\u4F5C\u3002";
      case "priority_fallback":
        return "\u5206\u6790\u4E0D\u53EF\u7528\uFF0C\u6309\u89C4\u5219\u4F18\u5148\u7EA7\u56DE\u9000\u3002";
      case "no_action_pass":
      default:
        return "\u5F53\u524D\u65E0\u53EF\u6267\u884C\u52A8\u4F5C\uFF0C\u56DE\u9000\u4E3A\u8FC7\u724C\u3002";
    }
  }
  buildTutorBullets(input, fallback) {
    const unique = Array.from(new Set(input.filter((item) => !!item && item.trim().length > 0)));
    if (unique.length === 0) {
      return [fallback];
    }
    return unique.slice(0, 2);
  }
  findChosenRecommendation(analysis, chosenAction, chosenCards) {
    if (!analysis?.recommendations?.length) {
      return void 0;
    }
    const normalizedCards = [...chosenCards || []].sort();
    const exact = analysis.recommendations.find((recommendation) => {
      if (recommendation.action !== chosenAction) {
        return false;
      }
      const recommendationCards = recommendation.card ? this.formatCards([recommendation.card]) : recommendation.meldCards ? this.formatCards(recommendation.meldCards) : void 0;
      const normalizedRecommendationCards = [...recommendationCards || []].sort();
      if (normalizedRecommendationCards.length === 0 && normalizedCards.length === 0) {
        return true;
      }
      if (normalizedRecommendationCards.length !== normalizedCards.length) {
        return false;
      }
      return normalizedRecommendationCards.every((card, index) => card === normalizedCards[index]);
    });
    return exact || analysis.recommendations.find((recommendation) => recommendation.action === chosenAction);
  }
  buildTutorTrace(recommendation, summary) {
    if (!recommendation) {
      return void 0;
    }
    const evidence = recommendation.evidence;
    const breakdown = evidence?.breakdown;
    const dimensions = [
      {
        key: "efficiency",
        title: "\u724C\u6548\u4E0E\u8FDB\u5F20",
        diagnosis: recommendation.posture === "attack" ? "\u672C\u624B\u4EE5\u63D0\u901F\u548C\u8FDB\u5F20\u6548\u7387\u4E3A\u4E3B\u3002" : "\u672C\u624B\u5148\u4FDD\u6301\u7ED3\u6784\u7A33\u5B9A\u4E0E\u6548\u7387\u3002",
        bullets: this.buildTutorBullets([
          evidence?.signals?.find((signal) => /提速|进张|听口|结构/.test(signal)),
          (evidence?.ukeireCount || 0) > 0 ? `\u540E\u7EED\u6709\u6548\u8FDB\u5F20\u7EA6 ${evidence?.ukeireCount} \u5F20` : void 0,
          recommendation.keyPoints?.[0]
        ], "\u4F18\u5148\u4FDD\u7559\u540E\u7EED\u53EF\u8F6C\u5316\u7684\u7ED3\u6784\u3002")
      },
      {
        key: "scoring",
        title: "\u505A\u724C\u4E0E\u7B97\u8D26",
        diagnosis: (breakdown?.scoreBonus || 0) > 0 ? "\u8BE5\u9009\u62E9\u5728\u5F97\u5206\u6F5C\u529B\u4E0A\u66F4\u4F18\u3002" : "\u8BE5\u9009\u62E9\u81F3\u5C11\u4E0D\u727A\u7272\u4E3B\u8DEF\u7EBF\u6536\u76CA\u3002",
        bullets: this.buildTutorBullets([
          (evidence?.scorePotential || 0) > 0 ? `\u5206\u6570\u6F5C\u529B\u7EA6 ${Math.round(evidence?.scorePotential || 0)}` : void 0,
          (evidence?.maxHuPoints || 0) > 0 ? `\u53EF\u89C1\u6700\u9AD8\u80E1\u606F\u7EA6 ${evidence?.maxHuPoints}` : void 0,
          evidence?.signals?.find((signal) => /名堂|得分|收益|胡息/.test(signal))
        ], "\u4F18\u5148\u4FDD\u8BC1\u53EF\u5151\u73B0\u6536\u76CA\uFF0C\u518D\u8FFD\u6C42\u4E0A\u9650\u3002")
      },
      {
        key: "defense",
        title: "\u9632\u5B88\u4E0E\u98CE\u9669",
        diagnosis: (evidence?.dangerScore || 0) >= 65 ? "\u5F53\u524D\u98CE\u9669\u504F\u9AD8\uFF0C\u5148\u63A7\u5236\u5931\u8BEF\u6210\u672C\u3002" : "\u98CE\u9669\u53EF\u63A7\uFF0C\u7EE7\u7EED\u63A8\u8FDB\u5F53\u524D\u8282\u594F\u3002",
        bullets: this.buildTutorBullets([
          (evidence?.dangerScore || 0) > 0 ? `\u5371\u9669\u5206\u7EA6 ${Math.round(evidence?.dangerScore || 0)}` : void 0,
          (breakdown?.dangerPenalty || 0) > 0 ? `\u98CE\u9669\u60E9\u7F5A\u7EA6 ${Math.round(breakdown?.dangerPenalty || 0)}` : void 0,
          recommendation.keyPoints?.find((point) => /风险|防守|安全|放炮/.test(point))
        ], "\u4FDD\u6301\u98CE\u9669\u53EF\u63A7\uFF0C\u907F\u514D\u88AB\u52A8\u9AD8\u5371\u5F03\u724C\u3002")
      }
    ];
    return {
      headline: recommendation.summary || summary,
      posture: recommendation.posture,
      dimensions
    };
  }
  buildActionSignature(action) {
    const cardIds = (action.cards || []).map((card) => card.id).sort().join(",");
    return `${action.type}|${cardIds}|${action.chiOptionId || ""}|${action.huOptionId || ""}`;
  }
  areSameCards(left = [], right = []) {
    const leftIds = left.map((card) => card.id).sort();
    const rightIds = right.map((card) => card.id).sort();
    if (leftIds.length !== rightIds.length) {
      return false;
    }
    return leftIds.every((id, index) => id === rightIds[index]);
  }
  resolveOptionAction(action, candidate) {
    if (action.type === "chi" && action.chiOptions?.length) {
      if (candidate.chiOptionId) {
        const option = action.chiOptions.find((item) => item.id === candidate.chiOptionId);
        if (!option) return null;
        if (candidate.cards?.length && !this.areSameCards(candidate.cards, option.selectedCards)) return null;
        return { cards: option.selectedCards, chiOptionId: option.id };
      }
      const candidateCards = candidate.cards || [];
      if (candidateCards.length > 0) {
        const matched = action.chiOptions.filter((option) => this.areSameCards(option.selectedCards, candidateCards));
        if (matched.length === 1) {
          return { cards: matched[0].selectedCards, chiOptionId: matched[0].id };
        }
        if (matched.length > 1 && this.areSameCards(candidateCards, action.cards)) {
          return { cards: matched[0].selectedCards, chiOptionId: matched[0].id };
        }
        return null;
      }
      if (action.chiOptions.length > 0) {
        return { cards: action.chiOptions[0].selectedCards, chiOptionId: action.chiOptions[0].id };
      }
      return null;
    }
    if (action.type === "hu" && action.huOptions?.length) {
      if (candidate.huOptionId) {
        const option = action.huOptions.find((item) => item.id === candidate.huOptionId);
        if (!option) return null;
        if (candidate.cards?.length && !this.areSameCards(candidate.cards, option.selectedCards)) return null;
        return { cards: option.selectedCards, huOptionId: option.id };
      }
      const candidateCards = candidate.cards || [];
      if (candidateCards.length > 0) {
        const matched = action.huOptions.filter((option) => this.areSameCards(option.selectedCards, candidateCards));
        if (matched.length === 1) {
          return { cards: matched[0].selectedCards, huOptionId: matched[0].id };
        }
        if (matched.length > 1 && this.areSameCards(candidateCards, action.cards)) {
          return { cards: matched[0].selectedCards, huOptionId: matched[0].id };
        }
        return null;
      }
      if (action.huOptions.length > 0) {
        return { cards: action.huOptions[0].selectedCards, huOptionId: action.huOptions[0].id };
      }
      return null;
    }
    return null;
  }
  normalizeToAvailableAction(candidate, availableActions) {
    for (const action of availableActions) {
      if (action.type !== candidate.type) {
        continue;
      }
      const optionResolved = this.resolveOptionAction(action, candidate);
      if (optionResolved) {
        return {
          ...candidate,
          type: action.type,
          cards: optionResolved.cards,
          chiOptionId: optionResolved.chiOptionId,
          huOptionId: optionResolved.huOptionId
        };
      }
      if (action.type === "chi" && action.chiOptions?.length || action.type === "hu" && action.huOptions?.length) {
        continue;
      }
      if (!this.areSameCards(candidate.cards || [], action.cards || [])) {
        continue;
      }
      if (candidate.type === "chi" && candidate.chiOptionId || candidate.type === "hu" && candidate.huOptionId) {
        continue;
      }
      return {
        ...candidate,
        type: action.type,
        cards: action.cards,
        chiOptionId: void 0,
        huOptionId: void 0
      };
    }
    return null;
  }
  matchesAvailableAction(candidate, action) {
    return this.normalizeToAvailableAction(candidate, [action]) !== null;
  }
  buildActionFromAvailable(action) {
    const optionResolved = this.resolveOptionAction(action, { cards: action.cards });
    return {
      type: action.type,
      playerId: this.playerId,
      cards: optionResolved?.cards || action.cards,
      chiOptionId: optionResolved?.chiOptionId,
      huOptionId: optionResolved?.huOptionId,
      timestamp: Date.now()
    };
  }
  buildActionFromRecommendation(action, recommendation) {
    const recommendationCards = recommendation.card ? [recommendation.card] : recommendation.meldCards || [];
    const optionResolved = this.resolveOptionAction(action, { cards: recommendationCards });
    return {
      type: action.type,
      playerId: this.playerId,
      cards: optionResolved?.cards || recommendationCards || action.cards,
      chiOptionId: optionResolved?.chiOptionId,
      huOptionId: optionResolved?.huOptionId,
      timestamp: Date.now()
    };
  }
  buildDecisionTrace(state, availableActions, outcome) {
    const mandatoryAction = availableActions.find((action) => action.isMandatory);
    const explicitHu = availableActions.find((action) => action.type === "hu");
    const normalized = this.normalizeToAvailableAction(outcome.action, availableActions);
    const chosenAction = normalized?.type || outcome.action.type;
    const chosenCards = this.formatCards(normalized?.cards || outcome.action.cards);
    const chosenSignature = this.buildActionSignature(normalized || outcome.action);
    const availableOptions = availableActions.map((action) => {
      const availableAction = this.buildActionFromAvailable(action);
      return {
        action: action.type,
        cards: this.formatCards(action.cards),
        isMandatory: !!action.isMandatory,
        isAvailable: true,
        isChosen: this.buildActionSignature(availableAction) === chosenSignature,
        reasoning: action.description
      };
    });
    const recommendationOptions = (outcome.analysis?.recommendations || []).slice(0, 4).map((recommendation) => ({
      action: recommendation.action,
      cards: recommendation.card ? this.formatCards([recommendation.card]) : recommendation.meldCards ? this.formatCards(recommendation.meldCards) : void 0,
      reasoning: recommendation.reasoning,
      winRate: recommendation.winRate,
      expectedScore: recommendation.expectedScore,
      priority: recommendation.priority,
      policyVersion: recommendation.policyVersion ?? "heuristic-baseline",
      policySource: recommendation.policySource ?? "heuristic",
      predictedWinRate: recommendation.predictedWinRate ?? recommendation.winRate,
      predictedExpectedScore: recommendation.predictedExpectedScore ?? recommendation.expectedScore,
      predictedScoreVariance: recommendation.predictedScoreVariance,
      deltaFromBest: recommendation.deltaFromBest,
      featureContributions: recommendation.featureContributions,
      baselinePriority: recommendation.baselinePriority,
      isAvailable: availableActions.some((action) => action.type === recommendation.action),
      isChosen: recommendation.action === chosenAction
    }));
    const summary = outcome.summary || this.summarizeDecisionSource(outcome.source, outcome.analysis);
    const chosenRecommendation = this.findChosenRecommendation(outcome.analysis, chosenAction, chosenCards);
    const tracePolicyVersion = chosenRecommendation?.policyVersion ?? outcome.analysis?.recommendations?.[0]?.policyVersion ?? (this.mode === "learned" ? "learned-runtime" : this.mode === "fast" ? "rule-conditioned-fast-v1" : "heuristic-baseline");
    const tracePolicySource = chosenRecommendation?.policySource ?? outcome.analysis?.recommendations?.[0]?.policySource ?? (this.mode === "learned" ? "learned" : "heuristic");
    const normalizedFlag = outcome.legalMeta?.normalized ?? (normalized ? this.buildActionSignature(outcome.action) !== this.buildActionSignature(normalized) : false);
    return {
      playerId: this.playerId,
      phase: state.phase,
      policyVersion: tracePolicyVersion,
      policySource: tracePolicySource,
      source: outcome.source,
      chosenAction,
      chosenCards,
      availableActions: availableOptions,
      topOptions: recommendationOptions,
      legal: {
        withinAvailableActions: !!normalized,
        explicitHuAvailable: !!explicitHu,
        explicitHuTaken: !!explicitHu && chosenAction === "hu",
        mandatoryAction: mandatoryAction?.type,
        mandatoryRespected: !mandatoryAction || chosenAction === mandatoryAction.type,
        normalized: normalizedFlag,
        fallbackApplied: outcome.legalMeta?.fallbackApplied,
        fallbackReason: outcome.legalMeta?.fallbackReason
      },
      reasoning: outcome.analysis?.reasoning,
      summary,
      tutor: this.buildTutorTrace(chosenRecommendation, summary)
    };
  }
  calculateResponseGainThreshold(gameState, dangerScore) {
    const turnPressure = Math.min(1, gameState.turnCount / 18);
    const deckPressure = gameState.remainingDeckCards <= 0 ? 1 : Math.max(0, 1 - Math.min(gameState.remainingDeckCards, 20) / 20);
    const dangerPressure = Math.max(0, Math.min(1, (dangerScore - 45) / 55));
    return 1 + turnPressure * 1.6 + deckPressure * 2 + dangerPressure * 1.6;
  }
  shouldSkipByResponseGate(gameState, candidateType, candidateScore, passScore, dangerScore) {
    if (gameState.phase !== "response_collecting") return false;
    if (!(candidateType === "chi" || candidateType === "peng" || candidateType === "zhao")) return false;
    if (candidateScore === void 0 || passScore === void 0) return false;
    const threshold = this.calculateResponseGainThreshold(gameState, dangerScore ?? 50);
    return candidateScore - passScore < threshold;
  }
  deriveOutcomeSourceFromAction(action) {
    if (action.isMandatory) return "mandatory";
    switch (action.type) {
      case "hu":
        return "explicit_hu";
      case "zhao":
      case "peng":
      case "chi":
        return "meld_priority";
      case "discard":
        return "best_legal_discard";
      case "draw":
      case "pass":
        return "default_available";
      default:
        return "priority_fallback";
    }
  }
  pickFallbackAction(availableActions) {
    const mandatoryAction = availableActions.find((action) => action.isMandatory);
    if (mandatoryAction) {
      return mandatoryAction;
    }
    const orderedTypes = ["hu", "zhao", "peng", "chi", "discard", "draw", "pass"];
    for (const actionType of orderedTypes) {
      const action = availableActions.find((candidate) => candidate.type === actionType);
      if (action) return action;
    }
    return availableActions[0];
  }
  buildFallbackOutcome(availableActions, fallbackReason, analysis) {
    const fallbackAction = this.pickFallbackAction(availableActions);
    if (!fallbackAction) {
      return {
        source: "no_action_pass",
        action: {
          type: "pass",
          playerId: this.playerId,
          cards: [],
          timestamp: Date.now()
        },
        analysis,
        legalMeta: {
          normalized: false,
          fallbackApplied: true,
          fallbackReason
        }
      };
    }
    return {
      source: this.deriveOutcomeSourceFromAction(fallbackAction),
      action: this.buildActionFromAvailable(fallbackAction),
      analysis,
      legalMeta: {
        normalized: false,
        fallbackApplied: true,
        fallbackReason
      }
    };
  }
  buildAnalysisCandidates(analysis, availableActions) {
    const candidates = [];
    const seen = /* @__PURE__ */ new Set();
    for (const ranked of analysis.rankedActions || []) {
      const action = ranked.recommendation ? this.buildActionFromRecommendation(ranked.availableAction, ranked.recommendation) : this.buildActionFromAvailable(ranked.availableAction);
      const signature = this.buildActionSignature(action);
      if (seen.has(signature)) continue;
      seen.add(signature);
      candidates.push({
        action,
        summary: ranked.recommendation?.summary || ranked.recommendation?.reasoning || ranked.summary,
        score: ranked.score,
        dangerScore: ranked.evidence?.dangerScore || ranked.recommendation?.evidence?.dangerScore
      });
    }
    for (const recommendation of analysis.recommendations || []) {
      const matchedActions = availableActions.filter((action) => action.type === recommendation.action);
      for (const matchedAction of matchedActions) {
        const action = this.buildActionFromRecommendation(matchedAction, recommendation);
        const signature = this.buildActionSignature(action);
        if (seen.has(signature)) continue;
        seen.add(signature);
        candidates.push({
          action,
          summary: recommendation.summary || recommendation.reasoning,
          dangerScore: recommendation.evidence?.dangerScore
        });
      }
    }
    return candidates;
  }
  async pickBestLegalDiscard(state, playerIndex, availableActions) {
    const discardActions = availableActions.filter((action) => action.type === "discard" && action.cards?.[0]);
    if (discardActions.length === 0) {
      return null;
    }
    const player = state.players[playerIndex];
    let bestAction = discardActions[0];
    let bestScore = Number.NEGATIVE_INFINITY;
    for (const action of discardActions) {
      await new Promise((resolve2) => globalThis.setTimeout(resolve2, 0));
      const discardCard = action.cards[0];
      const remainingCards = player.cards.filter((card) => card.id !== discardCard.id);
      const analysis = this.handAnalyzer.analyze(remainingCards, player.melds);
      const sameRankCount = player.cards.filter(
        (card) => card.value === discardCard.value && card.size === discardCard.size
      ).length;
      let score = 0;
      score += analysis.potentialMelds.length * 5;
      score += analysis.tingCards.length * 4;
      score -= analysis.looseCards.length * 2;
      score += (analysis.completeness || 0) * 10;
      if (sameRankCount >= 2) score -= 2.5;
      if (discardCard.isRed) score -= 2;
      if (score > bestScore) {
        bestScore = score;
        bestAction = action;
      }
    }
    return this.buildActionFromAvailable(bestAction);
  }
  pickFastDiscardAction(state, playerIndex, availableActions) {
    const discardActions = availableActions.filter((action) => action.type === "discard" && action.cards?.[0]);
    if (discardActions.length === 0) {
      return null;
    }
    const handCards = state.players[playerIndex]?.cards || [];
    const exactCountMap = /* @__PURE__ */ new Map();
    const valueCountMap = /* @__PURE__ */ new Map();
    for (const card of handCards) {
      const exactKey = `${card.size}_${card.value}`;
      exactCountMap.set(exactKey, (exactCountMap.get(exactKey) || 0) + 1);
      valueCountMap.set(card.value, (valueCountMap.get(card.value) || 0) + 1);
    }
    const getKeepScore = (card) => {
      const exactKey = `${card.size}_${card.value}`;
      const exactCount = exactCountMap.get(exactKey) || 0;
      const mixedSizeCount = Math.max(0, (valueCountMap.get(card.value) || 0) - exactCount);
      const sameSizeCards = handCards.filter((candidate) => candidate.id !== card.id && candidate.size === card.size);
      const nearLeft = sameSizeCards.some((candidate) => candidate.value === card.value - 1);
      const nearRight = sameSizeCards.some((candidate) => candidate.value === card.value + 1);
      const skipLeft = sameSizeCards.some((candidate) => candidate.value === card.value - 2);
      const skipRight = sameSizeCards.some((candidate) => candidate.value === card.value + 2);
      let score = 0;
      score += (exactCount - 1) * 5;
      score += mixedSizeCount * 3;
      score += (nearLeft ? 2.5 : 0) + (nearRight ? 2.5 : 0);
      score += (skipLeft ? 0.75 : 0) + (skipRight ? 0.75 : 0);
      score += card.isRed ? 1.5 : 0;
      score -= exactCount === 1 ? 4 : 0;
      score -= !nearLeft && !nearRight ? 1.25 : 0;
      return score;
    };
    let bestAction = discardActions[0];
    let bestScore = Number.POSITIVE_INFINITY;
    for (const action of discardActions) {
      const discardCard = action.cards?.[0];
      if (!discardCard) {
        continue;
      }
      const keepScore = getKeepScore(discardCard);
      if (keepScore < bestScore || keepScore === bestScore && bestAction.cards?.[0] && Number(!!discardCard.isRed) < Number(!!bestAction.cards[0].isRed)) {
        bestScore = keepScore;
        bestAction = action;
      }
    }
    return this.buildActionFromAvailable(bestAction);
  }
  async buildFastHeuristicOutcome(state, playerIndex, availableActions) {
    if (availableActions.length === 0) {
      return this.buildFallbackOutcome([], "no_available_action");
    }
    const mandatoryAction = availableActions.find((action) => action.isMandatory);
    if (mandatoryAction) {
      return { source: "mandatory", action: this.buildActionFromAvailable(mandatoryAction) };
    }
    const huAction = availableActions.find((action) => action.type === "hu");
    if (huAction) {
      return { source: "explicit_hu", action: this.buildActionFromAvailable(huAction) };
    }
    if (state.phase === "discarding") {
      const fastDiscard = this.pickFastDiscardAction(state, playerIndex, availableActions);
      if (fastDiscard) {
        return { source: "best_legal_discard", action: fastDiscard };
      }
    }
    const fallbackAction = this.pickFallbackAction(availableActions);
    if (!fallbackAction) {
      return this.buildFallbackOutcome([], "no_available_action");
    }
    return {
      source: this.deriveOutcomeSourceFromAction(fallbackAction),
      action: this.buildActionFromAvailable(fallbackAction)
    };
  }
  async mediumDecide(state, playerIndex, availableActions) {
    if (availableActions.length === 0) {
      return this.buildFallbackOutcome([], "no_available_action");
    }
    const mandatoryAction = availableActions.find((action) => action.isMandatory);
    if (mandatoryAction) {
      return { source: "mandatory", action: this.buildActionFromAvailable(mandatoryAction) };
    }
    const huAction = availableActions.find((action) => action.type === "hu");
    if (huAction) {
      return { source: "explicit_hu", action: this.buildActionFromAvailable(huAction) };
    }
    try {
      const discardActionCount = availableActions.filter((action) => action.type === "discard").length;
      const analysisDiscardTopK = Math.min(
        Math.max(this.analysisConfig.discardTopK ?? 5, 1),
        8
      );
      const analysis = await this.aiAnalyzer.analyze(state, playerIndex, {
        discardTopK: Math.min(Math.max(analysisDiscardTopK, discardActionCount > 0 ? 1 : 0), discardActionCount || analysisDiscardTopK),
        chiOptionTopK: this.analysisConfig.chiOptionTopK ?? 3,
        policyMode: this.mode === "learned" ? "learned" : "heuristic"
      });
      const candidates = this.buildAnalysisCandidates(analysis, availableActions);
      const passScore = analysis.rankedActions?.find((item) => item.availableAction.type === "pass")?.score;
      let illegalCount = 0;
      let gatedCount = 0;
      for (const candidate of candidates) {
        const normalized = this.normalizeToAvailableAction(candidate.action, availableActions);
        if (!normalized) {
          illegalCount += 1;
          continue;
        }
        if (this.shouldSkipByResponseGate(state, normalized.type, candidate.score, passScore, candidate.dangerScore)) {
          gatedCount += 1;
          continue;
        }
        return {
          source: "analysis_top",
          action: normalized,
          analysis,
          summary: candidate.summary,
          legalMeta: {
            normalized: this.buildActionSignature(candidate.action) !== this.buildActionSignature(normalized),
            fallbackApplied: false
          }
        };
      }
      if (candidates.length > 0) {
        const fallbackReason = gatedCount === candidates.length ? "response_gain_below_threshold" : illegalCount === candidates.length ? "illegal_analysis_candidate" : "analysis_candidate_exhausted";
        return this.buildFallbackOutcome(availableActions, fallbackReason, analysis);
      }
      return this.buildFallbackOutcome(availableActions, "analysis_no_candidate", analysis);
    } catch {
      return this.buildFallbackOutcome(availableActions, "analysis_error");
    }
  }
  async decideInternal(state, playerIndex, availableActions) {
    if (this.mode === "fast") {
      return this.buildFastHeuristicOutcome(state, playerIndex, availableActions);
    }
    return this.mediumDecide(state, playerIndex, availableActions);
  }
  async decideWithTrace(state) {
    const playerIndex = state.players.findIndex((player) => player.playerId === this.playerId);
    if (playerIndex === -1) {
      throw new Error(`Player ${this.playerId} not found in game state`);
    }
    const availableActions = state.availableActions || [];
    const outcome = await this.decideInternal(state, playerIndex, availableActions);
    const normalized = this.normalizeToAvailableAction(outcome.action, availableActions);
    const action = normalized || outcome.action;
    return {
      action,
      trace: this.buildDecisionTrace(state, availableActions, { ...outcome, action })
    };
  }
  async decide(state) {
    const playerIndex = state.players.findIndex((player) => player.playerId === this.playerId);
    if (playerIndex === -1) {
      throw new Error(`Player ${this.playerId} not found in game state`);
    }
    const availableActions = state.availableActions || [];
    const outcome = await this.decideInternal(state, playerIndex, availableActions);
    const normalized = this.normalizeToAvailableAction(outcome.action, availableActions);
    return normalized || outcome.action;
  }
  decideDiscard(state, playerIndex) {
    const player = state.players[playerIndex];
    const bestDiscard = this.handAnalyzer.findBestDiscard(player.cards, player.melds);
    return bestDiscard ? bestDiscard.card : player.cards[0];
  }
  decideMeld(_state, _action) {
    return true;
  }
  getPlayerId() {
    return this.playerId;
  }
};

// src/worker/ai-worker-runtime.ts
function isDecideRequest(request) {
  return request.type === "decideWithTrace";
}
function isAnalyzeRequest(request) {
  return request.type === "analyze";
}
function isLoadPolicyArtifactRequest(request) {
  return request.type === "loadPolicyArtifact";
}
var aiAgentPool = /* @__PURE__ */ new Map();
var sharedAnalyzer = null;
function getAIAnalyzer() {
  if (!sharedAnalyzer) {
    sharedAnalyzer = new AIAnalyzer();
  }
  return sharedAnalyzer;
}
function getOrCreateAIAgent(playerId, mode = "learned") {
  const cacheKey = `${playerId}:${mode}`;
  const cached = aiAgentPool.get(cacheKey);
  if (cached) {
    return cached;
  }
  const created = new AIPlayerAgent(playerId, { mode });
  aiAgentPool.set(cacheKey, created);
  return created;
}
async function handleAIWorkerRequest(request) {
  try {
    if (request.type === "ready") {
      return {
        id: request.id,
        type: "ready",
        success: true,
        payload: { ready: true }
      };
    }
    if (isDecideRequest(request)) {
      const agent = getOrCreateAIAgent(request.payload.playerId, request.payload.mode || "learned");
      const result = await agent.decideWithTrace(request.payload.state);
      return {
        id: request.id,
        type: "decideWithTrace",
        success: true,
        payload: result
      };
    }
    if (isAnalyzeRequest(request)) {
      const analyzer = getAIAnalyzer();
      const analysis = await analyzer.analyze(
        request.payload.state,
        request.payload.playerIndex,
        request.payload.options
      );
      return {
        id: request.id,
        type: "analyze",
        success: true,
        payload: analysis
      };
    }
    if (isLoadPolicyArtifactRequest(request)) {
      const artifact = request.payload?.resetToDefault ? resetPolicyArtifact() : loadPolicyArtifact(request.payload?.artifact);
      return {
        id: request.id,
        type: "loadPolicyArtifact",
        success: true,
        payload: {
          policyVersion: artifact.policyVersion
        }
      };
    }
    return {
      id: request.id,
      type: request.type,
      success: false,
      error: {
        code: "UNSUPPORTED_REQUEST",
        message: `Unsupported AI worker request: ${request.type}`
      }
    };
  } catch (error) {
    return {
      id: request.id,
      type: request.type,
      success: false,
      error: {
        code: "REQUEST_FAILED",
        message: error instanceof Error ? error.message : String(error)
      }
    };
  }
}

// src/bridge/godot-action-guard.ts
function isLegalGodotAction(currentState, action) {
  const actingPlayerIndex2 = currentState.phase === "response_collecting" && typeof currentState.responseWindow?.currentResponderIndex === "number" ? currentState.responseWindow.currentResponderIndex : currentState.currentPlayerIndex;
  const currentPlayer = currentState.players[actingPlayerIndex2];
  if (!currentPlayer || action.playerId !== currentPlayer.playerId) return false;
  const offered = findOfferedAction(currentState, action);
  if (!offered) return false;
  if (action.type === "chi") {
    return !!action.chiOptionId && (offered.chiOptions || []).some((option) => option.id === action.chiOptionId);
  }
  if (action.type === "hu" && (offered.huOptions || []).length > 0) {
    return !!action.huOptionId && offered.huOptions.some((option) => option.id === action.huOptionId);
  }
  return true;
}
function findOfferedAction(currentState, action) {
  if (action.type === "discard") {
    const cardId = action.cards?.[0]?.id;
    return cardId ? currentState.availableActions.find((candidate) => candidate.type === "discard" && candidate.cards.some((card) => card.id === cardId)) : void 0;
  }
  return currentState.availableActions.find((candidate) => candidate.type === action.type);
}
function normalizeGodotAction(currentState, action) {
  if (!isLegalGodotAction(currentState, action)) return null;
  const offered = findOfferedAction(currentState, action);
  const normalized = { ...action, cards: offered.cards };
  if (action.type === "discard") {
    normalized.cards = [offered.cards.find((card) => card.id === action.cards?.[0]?.id)];
  } else if (action.type === "chi") {
    const option = offered.chiOptions.find((item) => item.id === action.chiOptionId);
    normalized.cards = option.selectedCards;
    normalized.chiOptionId = option.id;
  } else if (action.type === "hu" && offered.huOptions?.length) {
    const option = offered.huOptions.find((item) => item.id === action.huOptionId);
    normalized.cards = option.selectedCards.length ? option.selectedCards : offered.cards;
    normalized.huOptionId = option.id;
  }
  return normalized;
}

// scripts/godot-ai-runtime-server.ts
var GODOT_PROTOCOL_VERSION = "daer-godot-v2";
var GODOT_RUNTIME_VERSION = "daer-bridge-session-v6";
var GODOT_MAX_REQUEST_BYTES = 64 * 1024;
var BridgeRequestError = class extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
    this.name = "BridgeRequestError";
  }
};
function isGodotParentAlive(processId) {
  if (!Number.isSafeInteger(processId) || processId <= 0) return false;
  try {
    process.kill(processId, 0);
    return true;
  } catch {
    return false;
  }
}
function shouldTerminateForGodotParent(parentProcessId2, isParentAlive = isGodotParentAlive) {
  return Number.isSafeInteger(parentProcessId2) && parentProcessId2 > 0 && !isParentAlive(parentProcessId2);
}
function sendJson(response, status, body) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8"
  });
  response.end(JSON.stringify(body));
}
async function readJson(request) {
  const chunks = [];
  let totalBytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk);
    totalBytes += buffer.byteLength;
    if (totalBytes > GODOT_MAX_REQUEST_BYTES) {
      request.resume();
      throw new BridgeRequestError(413, "Request body is too large.");
    }
    chunks.push(buffer);
  }
  const text = Buffer.concat(chunks).toString("utf8").trim();
  if (!text) return {};
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new BridgeRequestError(400, "Request body must be valid JSON.");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new BridgeRequestError(400, "Request body must be a JSON object.");
  }
  return parsed;
}
function stateSignature(gameState) {
  return JSON.stringify({
    phase: gameState.phase,
    currentPlayerIndex: gameState.currentPlayerIndex,
    turnCount: gameState.turnCount,
    pendingCardSource: gameState.pendingCardSource,
    responder: gameState.responseWindow?.currentResponderIndex,
    responseWindowId: gameState.responseWindow?.id,
    deadlineAt: gameState.responseWindow?.deadlineAt,
    responses: gameState.responseWindow?.responses.length || 0,
    activeCard: gameState.discardPile.lastDiscard?.id,
    hands: gameState.players.map((player) => player.cards.length),
    melds: gameState.players.map((player) => player.melds.length),
    ruleVersion: gameState.ruleVersion,
    openingPhase: gameState.openingPhase,
    drawOrdinal: gameState.drawOrdinal,
    gameOver: gameState.isGameOver
  });
}
function actingPlayerIndex(currentState) {
  return currentState.phase === "response_collecting" && typeof currentState.responseWindow?.currentResponderIndex === "number" ? currentState.responseWindow.currentResponderIndex : currentState.currentPlayerIndex;
}
function aiMode(value) {
  return value === "fast" || value === "medium" || value === "learned" ? value : "learned";
}
function buildGodotHandPresentation(currentState) {
  const humanPlayer = currentState.players[0];
  if (!humanPlayer) return { lockedHandMelds: [] };
  const meldDetector = new MeldDetector();
  const quadruples = meldDetector.detectQuadruples(humanPlayer.cards).melds;
  const quadrupleIds = new Set(quadruples.flatMap((meld) => meld.cards.map((card) => card.id)));
  const triples = meldDetector.detectTriples(
    humanPlayer.cards.filter((card) => !quadrupleIds.has(card.id))
  ).melds;
  const discardIds = new Set(
    currentState.availableActions.filter((action) => action.type === "discard").flatMap((action) => action.cards.map((card) => card.id))
  );
  const toPresentation = (type, label, cards) => {
    const cardIds = cards.map((card) => card.id).sort();
    return {
      id: `${type}:${cardIds.join("|")}`,
      type,
      label,
      cardIds,
      isConcealed: true,
      draggable: false
    };
  };
  const candidates = [
    ...quadruples.map((meld) => toPresentation("quadruple", "\u63D0", meld.cards)),
    ...triples.map((meld) => toPresentation("triple", "\u574E", meld.cards))
  ];
  return {
    // The TurnManager intentionally opens every card as a deadlock fallback
    // when a whole hand is locked. In that state availableActions wins.
    lockedHandMelds: candidates.filter((meld) => meld.cardIds.every((id) => !discardIds.has(id)))
  };
}
function presentState(currentState, lastTransition) {
  const activePlayerIndex = actingPlayerIndex(currentState);
  return {
    ...currentState,
    handPresentation: buildGodotHandPresentation(currentState),
    activePlayerIndex,
    awaitingHumanInput: !currentState.isGameOver && activePlayerIndex === 0 && currentState.availableActions.length > 0,
    lastTransition
  };
}
function presentReplaySteps(steps) {
  return steps.map((step) => {
    const rawState = step.state;
    if (!rawState || typeof rawState !== "object" || Array.isArray(rawState)) return step;
    return { ...step, state: presentState(rawState, step.transition) };
  });
}
function createGodotAiRuntimeServer(options = {}) {
  const manager = new GameManager(options.clock);
  const requestAI = options.requestAI || handleAIWorkerRequest;
  const sessionId2 = options.sessionId?.trim() || "";
  const configuredAuthToken = options.authToken?.trim() || process.env.DAER_BRIDGE_TOKEN?.trim() || "";
  if (configuredAuthToken && Buffer.byteLength(configuredAuthToken, "utf8") < 32) {
    throw new Error("Bridge auth token must contain at least 256 bits.");
  }
  const authToken = configuredAuthToken || randomBytes(32).toString("hex");
  let state = null;
  let gameConfig = null;
  let actionLog = [];
  let replaySteps = [];
  let lastTransition;
  let responseTimer;
  let scheduledTimeoutKey;
  function transitionFor(before, after, action) {
    const actorPlayerIndex = before.players.findIndex((player) => player.playerId === action.playerId);
    return {
      sequence: actionLog.length + 1,
      actionType: action.type,
      actorPlayerIndex,
      phaseBefore: before.phase,
      phaseAfter: after.phase,
      occurredAt: action.timestamp
    };
  }
  function persist() {
    if (!options.persistenceFile || !gameConfig || !state) return;
    mkdirSync(dirname(options.persistenceFile), { recursive: true });
    writeFileSync(options.persistenceFile, JSON.stringify({ version: 3, gameConfig, actionLog, state, replaySteps }, null, 2), "utf8");
  }
  function clearResponseTimer() {
    if (responseTimer) clearTimeout(responseTimer);
    responseTimer = void 0;
    scheduledTimeoutKey = void 0;
  }
  function commitTransition(before, after, action, decision) {
    lastTransition = transitionFor(before, after, action);
    state = after;
    actionLog.push(action);
    replaySteps.push({ state, action, ...decision ? { decision } : {}, transition: lastTransition });
    persist();
  }
  function runResponseTimeout() {
    const current = state;
    const window = current?.responseWindow;
    if (!current || !window || typeof window.currentResponderIndex !== "number") {
      clearResponseTimer();
      return;
    }
    const action = {
      type: window.timeoutAction,
      playerId: current.players[window.currentResponderIndex].playerId,
      cards: [],
      timestamp: Date.now(),
      responseWindowId: window.id,
      isSystem: true
    };
    const next = manager.processAction(current, action);
    if (stateSignature(current) === stateSignature(next)) {
      clearResponseTimer();
      return;
    }
    commitTransition(current, next, action);
    syncResponseTimer();
  }
  function syncResponseTimer() {
    const window = state?.responseWindow;
    if (!window || typeof window.currentResponderIndex !== "number") {
      clearResponseTimer();
      return;
    }
    const key = `${window.id}:${window.currentResponderIndex}:${window.timeoutAction}:${window.deadlineAt}`;
    if (key === scheduledTimeoutKey) return;
    clearResponseTimer();
    scheduledTimeoutKey = key;
    responseTimer = setTimeout(runResponseTimeout, Math.max(0, window.deadlineAt - Date.now()));
  }
  function restore() {
    if (!options.persistenceFile) return;
    try {
      const snapshot = JSON.parse(readFileSync(options.persistenceFile, "utf8"));
      if (snapshot.version !== 3 || !snapshot.gameConfig || typeof snapshot.gameConfig.ruleVersion !== "string" || !Array.isArray(snapshot.actionLog)) return;
      gameConfig = snapshot.gameConfig;
      state = manager.createGame(gameConfig);
      actionLog = [];
      replaySteps = Array.isArray(snapshot.replaySteps) ? snapshot.replaySteps : [{ state, action: { type: "start", cards: [] } }];
      for (const loggedAction of snapshot.actionLog) {
        const normalized = normalizeGodotAction(state, loggedAction);
        if (!normalized) throw new Error("Persisted action is no longer legal");
        const next = manager.processAction(state, normalized);
        if (stateSignature(state) === stateSignature(next)) throw new Error("Persisted action no longer advances the game");
        lastTransition = transitionFor(state, next, normalized);
        state = next;
        actionLog.push(normalized);
      }
    } catch {
      state = null;
      gameConfig = null;
      actionLog = [];
      lastTransition = void 0;
    }
  }
  restore();
  syncResponseTimer();
  function requireState() {
    if (!state) throw new Error("No active game. Call /api/game/new first.");
    return state;
  }
  function actionForCurrentPlayer(raw) {
    const currentState = requireState();
    const current = currentState.players[actingPlayerIndex(currentState)];
    return {
      type: String(raw.type || "pass"),
      playerId: String(raw.playerId || current.playerId),
      cards: Array.isArray(raw.cards) ? raw.cards : [],
      chiOptionId: typeof raw.chiOptionId === "string" ? raw.chiOptionId : void 0,
      huOptionId: typeof raw.huOptionId === "string" ? raw.huOptionId : void 0,
      timestamp: Date.now(),
      responseWindowId: typeof raw.responseWindowId === "string" ? raw.responseWindowId : void 0,
      isSystem: raw.isSystem === true
    };
  }
  function rejectFinishedGame(response, currentState) {
    if (!currentState.isGameOver) return false;
    sendJson(response, 409, { ok: false, error: "Game is already over.", state: presentState(currentState) });
    return true;
  }
  async function decide(currentState, mode) {
    const playerIndex = actingPlayerIndex(currentState);
    const player = currentState.players[playerIndex];
    const decisionState = playerIndex === currentState.currentPlayerIndex ? currentState : { ...currentState, currentPlayerIndex: playerIndex };
    const request = (requestedMode) => requestAI({
      id: "godot-ai-" + Date.now(),
      type: "decideWithTrace",
      payload: { playerId: player.playerId, state: decisionState, mode: requestedMode }
    });
    let result = await request(mode);
    let fallbackReason = "";
    if ((!result.success || result.type !== "decideWithTrace") && mode === "learned") {
      fallbackReason = !result.success ? result.error.message : "unexpected_learned_response";
      result = await request("medium");
    }
    if (!result.success || result.type !== "decideWithTrace") {
      throw new Error(!result.success ? result.error.message : "Unexpected AI response");
    }
    let normalized = normalizeGodotAction(currentState, result.payload.action);
    if (!normalized && mode === "learned" && !fallbackReason) {
      fallbackReason = "learned_illegal_action";
      result = await request("medium");
      if (!result.success || result.type !== "decideWithTrace") {
        throw new Error(!result.success ? result.error.message : "Medium fallback returned an unexpected response");
      }
      normalized = normalizeGodotAction(currentState, result.payload.action);
    }
    if (!normalized) {
      throw new Error("AI returned an action that is not legal in the current state.");
    }
    result.payload.action = normalized;
    if (!fallbackReason && mode === "learned" && result.payload.trace.policySource !== "learned") {
      fallbackReason = "learned_policy_fallback";
    }
    if (fallbackReason) {
      result.payload.trace.policySource = "fallback";
      result.payload.trace.policyVersion = "heuristic-baseline";
      result.payload.trace.legal.fallbackApplied = true;
      result.payload.trace.legal.fallbackReason = fallbackReason === "learned_illegal_action" ? "learned_illegal_action" : fallbackReason === "learned_policy_fallback" ? "learned_policy_fallback" : "learned_runtime_failed";
      result.payload.trace.summary = fallbackReason === "learned_illegal_action" ? "\u539F\u7248\u5F3A\u5316\u7B56\u7565\u8FD4\u56DE\u7684\u52A8\u4F5C\u4E0E\u5F53\u524D\u89C4\u5219\u4E0D\u5339\u914D\uFF0C\u5DF2\u964D\u7EA7\u4E3A\u89C4\u5219\u5206\u6790\u3002" : fallbackReason === "learned_policy_fallback" ? "\u5F53\u524D\u5C40\u9762\u7531\u89C4\u5219\u5206\u6790\u63A5\u7BA1\uFF0C\u5DF2\u9009\u62E9\u5F53\u524D\u5408\u6CD5\u52A8\u4F5C\u3002" : "\u539F\u7248\u5F3A\u5316\u7B56\u7565\u4E0D\u53EF\u7528\uFF0C\u5DF2\u964D\u7EA7\u4E3A\u89C4\u5219\u5206\u6790\uFF1A" + fallbackReason;
    }
    return result.payload;
  }
  async function route(request, response) {
    const authorization = request.headers.authorization || "";
    const providedToken = authorization.startsWith("Bearer ") ? authorization.slice("Bearer ".length).trim() : "";
    const expectedToken = Buffer.from(authToken, "utf8");
    const actualToken = Buffer.from(providedToken, "utf8");
    if (actualToken.length !== expectedToken.length || !timingSafeEqual(actualToken, expectedToken)) {
      sendJson(response, 401, { ok: false, error: "Unauthorized" });
      return;
    }
    const url = new URL(request.url || "/", "http://127.0.0.1");
    if (request.method === "GET" && url.pathname === "/health") {
      sendJson(response, 200, { ok: true, runtime: "daer-core", protocolVersion: GODOT_PROTOCOL_VERSION, runtimeVersion: GODOT_RUNTIME_VERSION, sessionId: sessionId2, activeGame: !!state });
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/game/state") {
      sendJson(response, 200, { ok: true, state: presentState(requireState(), lastTransition) });
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/game/replay") {
      requireState();
      sendJson(response, 200, { ok: true, steps: presentReplaySteps(replaySteps) });
      return;
    }
    if (request.method !== "POST") {
      sendJson(response, 404, { ok: false, error: "Not found" });
      return;
    }
    const contentType = request.headers["content-type"]?.split(";", 1)[0].trim().toLowerCase();
    if (contentType !== "application/json") {
      sendJson(response, 415, { ok: false, error: "Content-Type must be application/json." });
      return;
    }
    const body = await readJson(request);
    if (url.pathname === "/api/game/new") {
      const bottomCardCount = Number(body.bottomCardCount);
      const seed = typeof body.seed === "number" ? body.seed : Math.floor(Math.random() * 2147483647);
      const bottomCardCountValue = bottomCardCount === 0 ? 0 : bottomCardCount === 1 ? 1 : 2;
      actionLog = [];
      state = manager.createGame({ playerCount: 3, bottomCardCount: bottomCardCountValue, seed });
      gameConfig = { ...state.ruleProfile, seed };
      lastTransition = {
        sequence: 0,
        actionType: "start",
        actorPlayerIndex: actingPlayerIndex(state),
        phaseBefore: state.phase,
        phaseAfter: state.phase,
        occurredAt: Date.now()
      };
      replaySteps = [{ state, action: { type: "start", cards: [] }, transition: lastTransition }];
      persist();
      syncResponseTimer();
      sendJson(response, 200, { ok: true, state: presentState(state, lastTransition) });
      return;
    }
    if (url.pathname === "/api/game/action") {
      const currentState = requireState();
      if (rejectFinishedGame(response, currentState)) return;
      if (!presentState(currentState).awaitingHumanInput) {
        sendJson(response, 409, { ok: false, error: "The game is not waiting for the human player.", state: presentState(currentState) });
        return;
      }
      if (currentState.responseWindow && body.responseWindowId !== currentState.responseWindow.id) {
        sendJson(response, 409, { ok: false, error: "The response window is stale or missing.", state: presentState(currentState) });
        return;
      }
      const action = normalizeGodotAction(currentState, actionForCurrentPlayer(body));
      if (!action) {
        sendJson(response, 400, { ok: false, error: "Action is not legal in the current state.", state: presentState(currentState) });
        return;
      }
      const next = manager.processAction(currentState, action);
      if (stateSignature(currentState) === stateSignature(next)) {
        sendJson(response, 409, { ok: false, error: "The action did not advance the game.", state: presentState(currentState) });
        return;
      }
      commitTransition(currentState, next, action);
      syncResponseTimer();
      sendJson(response, 200, { ok: true, state: presentState(state, lastTransition), action });
      return;
    }
    if (url.pathname === "/api/game/timeout") {
      const currentState = requireState();
      if (rejectFinishedGame(response, currentState)) return;
      const window = currentState.responseWindow;
      if (!window || typeof window.currentResponderIndex !== "number") {
        sendJson(response, 409, { ok: false, error: "There is no active response window.", state: presentState(currentState) });
        return;
      }
      const requestedWindowId = typeof body.responseWindowId === "string" ? body.responseWindowId : "";
      const requestedType = typeof body.type === "string" ? body.type : window.timeoutAction;
      const action = {
        type: requestedType,
        playerId: currentState.players[window.currentResponderIndex].playerId,
        cards: [],
        timestamp: Date.now(),
        responseWindowId: requestedWindowId,
        isSystem: true
      };
      const next = manager.processAction(currentState, action);
      if (stateSignature(currentState) === stateSignature(next)) {
        sendJson(response, 409, { ok: false, error: "The timeout action is stale, early, or not legal.", state: presentState(currentState) });
        return;
      }
      commitTransition(currentState, next, action);
      syncResponseTimer();
      sendJson(response, 200, { ok: true, state: presentState(state, lastTransition), action });
      return;
    }
    if (url.pathname === "/api/game/ai-step") {
      const currentState = requireState();
      if (rejectFinishedGame(response, currentState)) return;
      if (presentState(currentState).awaitingHumanInput) {
        sendJson(response, 409, { ok: false, error: "The game is waiting for the human player.", state: presentState(currentState) });
        return;
      }
      const decision = await decide(currentState, aiMode(body.mode));
      const action = decision.action;
      const next = manager.processAction(currentState, action);
      if (stateSignature(currentState) === stateSignature(next)) {
        sendJson(response, 409, { ok: false, error: "The AI action did not advance the game.", state: presentState(currentState) });
        return;
      }
      commitTransition(currentState, next, action, decision);
      syncResponseTimer();
      sendJson(response, 200, { ok: true, state: presentState(state, lastTransition), action, decision });
      return;
    }
    if (url.pathname === "/api/game/advice") {
      const currentState = requireState();
      if (rejectFinishedGame(response, currentState)) return;
      const rawIndex = typeof body.playerIndex === "number" ? body.playerIndex : currentState.currentPlayerIndex;
      const playerIndex = Math.max(0, Math.min(currentState.players.length - 1, rawIndex));
      const result = await handleAIWorkerRequest({
        id: "godot-advice-" + Date.now(),
        type: "analyze",
        payload: {
          playerIndex,
          state: currentState,
          options: { discardTopK: 1, chiOptionTopK: 1, policyMode: body.mode === "learned" ? "learned" : "heuristic" }
        }
      });
      if (!result.success || result.type !== "analyze") throw new Error(!result.success ? result.error.message : "Unexpected analysis response");
      sendJson(response, 200, { ok: true, state: presentState(currentState, lastTransition), analysis: result.payload });
      return;
    }
    sendJson(response, 404, { ok: false, error: "Not found" });
  }
  const server2 = createServer((request, response) => {
    route(request, response).catch((error) => {
      if (error instanceof BridgeRequestError) {
        sendJson(response, error.statusCode, { ok: false, error: error.message });
        return;
      }
      sendJson(response, 500, { ok: false, error: "Internal server error." });
    });
  });
  server2.on("close", clearResponseTimer);
  return server2;
}

// scripts/godot-ai-server.ts
import { resolve } from "node:path";
var port = Number(process.env.DAER_GODOT_AI_PORT || 48152);
var persistenceFile = process.env.DAER_GODOT_STATE_FILE || resolve(process.cwd(), ".daer", "godot-game-state.json");
var sessionId = (process.env.DAER_GODOT_SESSION_ID || "").trim();
var parentProcessId = Number(process.env.DAER_GODOT_PARENT_PID || 0);
var server = createGodotAiRuntimeServer({ persistenceFile, sessionId });
var parentWatch;
var closing = false;
function closeBridge() {
  if (closing) return;
  closing = true;
  if (parentWatch) clearInterval(parentWatch);
  const forceExit = setTimeout(() => process.exit(0), 1500);
  forceExit.unref();
  server.close(() => {
    clearTimeout(forceExit);
    process.exit(0);
  });
}
server.once("close", () => {
  if (parentWatch) clearInterval(parentWatch);
});
server.listen(port, "127.0.0.1", () => {
  console.log("[godot-ai] daer core runtime listening on http://127.0.0.1:" + port + (sessionId ? " for " + sessionId : ""));
  if (!Number.isSafeInteger(parentProcessId) || parentProcessId <= 0) return;
  parentWatch = setInterval(() => {
    if (shouldTerminateForGodotParent(parentProcessId)) {
      console.log("[godot-ai] Godot parent exited; closing Bridge.");
      closeBridge();
    }
  }, 1e3);
  parentWatch.unref();
});
process.once("SIGINT", closeBridge);
process.once("SIGTERM", closeBridge);
