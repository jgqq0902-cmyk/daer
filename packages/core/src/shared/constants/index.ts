/**
 * 共享常量统一导出
 */

export {
  SMALL_RANKS,
  BIG_RANKS,
  ALL_RANKS,
  RED_VALUES,
  RANK_TO_VALUE,
  VALUE_TO_SMALL_RANK,
  VALUE_TO_BIG_RANK,
  isRedRank,
  isSmallRank,
  isBigRank,
  getRankColor,
  getRankSize,
  SPECIAL_2710_VALUES,
  isSpecial2710,
  isSequential,
  DECK_CONFIG,
  DEAL_CONFIG,
  CARD_DISPLAY,
  isRedCard,
} from './cards';

export * from './scoring';

export {
  MELD_DEFINITIONS,
  MANDATORY_MELDS,
  MANDATORY_PENG,
  getMeldName,
  getMeldDescription,
  getMeldCardCount,
  isMandatoryMeld,
  CHI_RULES,
  COMPARE_RULES,
  ACTION_PRIORITY,
  HEAVENLY_WIN,
  isHeavenlyWin,
} from './melds';
