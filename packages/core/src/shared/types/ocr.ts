/**
 * OCR 相关类型定义
 * 屏幕识别和牌面OCR的类型系统
 * 当前版本为接口预留，下个版本实现
 */

import { Card, CardPosition } from './card';

/**
 * 屏幕区域
 */
export interface ScreenRegion {
  x: number;
  y: number;
  width: number;
  height: number;
  /** 显示名称 */
  displayName: string;
  /** 关联的游戏平台名称 */
  platformName?: string;
}

/**
 * 识别到的牌
 */
export interface RecognizedCard extends Card {
  /** 屏幕上的位置 */
  position: CardPosition;
  /** 识别置信度 (0-1) */
  confidence: number;
  /** 识别方法 */
  recognitionMethod: 'template' | 'ocr' | 'hybrid';
  /** 原始OCR文本 */
  rawText?: string;
}

/**
 * OCR 结果
 */
export interface OCRResult {
  /** 识别到的牌 */
  cards: RecognizedCard[];
  /** 整体置信度 */
  confidence: number;
  /** 时间戳 */
  timestamp: number;
  /** 处理耗时 (ms) */
  processingTime: number;
  /** 识别区域 */
  region: ScreenRegion;
  /** 错误信息 */
  errors?: string[];
}

/**
 * 图像预处理选项
 */
export interface PreprocessingOptions {
  /** 灰度化 */
  grayscale: boolean;
  /** 二值化 */
  threshold: boolean;
  /** 降噪 */
  denoise: boolean;
  /** 对比度调整 */
  contrast: number;
  /** 亮度调整 */
  brightness: number;
  /** 缩放比例 */
  scale?: number;
}

/**
 * OCR 配置
 */
export interface OCRConfig {
  /** 识别区域 */
  screenRegion: ScreenRegion;
  /** 轮询间隔 (ms) */
  pollingInterval: number;
  /** 置信度阈值 */
  confidenceThreshold: number;
  /** 是否使用预处理 */
  usePreprocessing: boolean;
  /** 预处理选项 */
  preprocessingOptions: PreprocessingOptions;
  /** 是否使用模板匹配辅助 */
  useTemplateMatching: boolean;
}

/**
 * 屏幕捕获配置
 */
export interface ScreenCaptureConfig {
  /** 捕获帧率 */
  frameRate: number;
  /** 图像质量 */
  quality: number;
  /** 是否只在变化时捕获 */
  captureOnChangeOnly: boolean;
  /** 变化检测阈值 */
  changeThreshold: number;
}

/**
 * 牌局布局解析结果
 */
export interface GameLayout {
  /** 玩家手牌区域 */
  playerHands: RecognizedCard[][];
  /** 桌面牌型区域 */
  tableMelds: RecognizedCard[][];
  /** 弃牌堆 */
  discardPiles: RecognizedCard[][];
  /** 当前出牌区域 */
  currentPlay?: RecognizedCard;
  /** 解析置信度 */
  confidence: number;
  /** 解析时间戳 */
  timestamp: number;
}

/**
 * 区域类型
 */
export enum RegionType {
  /** 玩家手牌 */
  PLAYER_HAND = 'player_hand',
  /** 桌面牌型 */
  TABLE_MELD = 'table_meld',
  /** 弃牌堆 */
  DISCARD_PILE = 'discard_pile',
  /** 当前出牌 */
  CURRENT_PLAY = 'current_play'
}

/**
 * 区域配置
 */
export interface RegionConfig {
  type: RegionType;
  /** 玩家索引 (对于手牌) */
  playerIndex?: number;
  /** 区域位置 */
  region: ScreenRegion;
  /** 期望的牌数量范围 */
  expectedCardRange?: [number, number];
  /** 牌的排列方向 */
  orientation: 'horizontal' | 'vertical';
}

/**
 * 牌面识别器接口（平台无关，下个版本实现）
 */
export interface ICardRecognizer {
  /** 识别图像中的牌 */
  recognize(imageData: ArrayBuffer): Promise<OCRResult>;
  /** 初始化识别器 */
  initialize(): Promise<void>;
  /** 释放资源 */
  dispose(): Promise<void>;
  /** 是否已初始化 */
  isReady(): boolean;
}

/**
 * 屏幕捕获器接口（平台无关，下个版本实现）
 */
export interface IScreenCapturer {
  /** 开始捕获 */
  startCapture(config: ScreenCaptureConfig): Promise<void>;
  /** 停止捕获 */
  stopCapture(): Promise<void>;
  /** 获取当前帧 */
  getCurrentFrame(): Promise<ArrayBuffer | null>;
  /** 是否正在捕获 */
  isCapturing(): boolean;
}

/**
 * OCR 模板
 */
export interface CardTemplate {
  /** 牌面 */
  rank: string;
  /** 大小写 */
  size: 'big' | 'small';
  /** 模板图像数据 */
  templateData: ArrayBuffer;
  /** 匹配阈值 */
  matchThreshold: number;
}

/**
 * 默认OCR配置
 */
export const DEFAULT_OCR_CONFIG: OCRConfig = {
  screenRegion: {
    x: 0,
    y: 0,
    width: 1920,
    height: 1080,
    displayName: '默认区域'
  },
  pollingInterval: 1000,
  confidenceThreshold: 0.7,
  usePreprocessing: true,
  preprocessingOptions: {
    grayscale: true,
    threshold: true,
    denoise: true,
    contrast: 1.2,
    brightness: 1.0,
    scale: 2.0
  },
  useTemplateMatching: true
};

/**
 * 默认预处理选项
 */
export const DEFAULT_PREPROCESSING_OPTIONS: PreprocessingOptions = {
  grayscale: true,
  threshold: true,
  denoise: true,
  contrast: 1.2,
  brightness: 1.0,
  scale: 2.0
};
