/**
 * 游戏模拟器
 * 运行完整的游戏模拟并收集统计数据
 */

import { GameState, GamePhase } from '../shared/types';
import { GameManager, gameManager } from './game-manager';
import { AIPlayerAgent } from '../ai/ai-player-agent';
import { SimulationConfig, SimulationResult, GameStats, PlayerAction } from '../shared/types/simulation';

/**
 * 游戏模拟器类
 */
export class GameSimulator {
  private gm: GameManager;
  private aiAgents: Map<string, AIPlayerAgent> = new Map();

  constructor() {
    this.gm = gameManager;
  }

  /**
   * 运行单次模拟
   */
  async simulate(config: SimulationConfig): Promise<SimulationResult> {
    const aiPlayers = config.aiPlayers ?? Array.from({ length: config.playerCount }, (_, i) => i);

    // 创建 AI 代理
    this.createAIAgents({ ...config, aiPlayers });

    // 创建新游戏
    let gameState = this.gm.createGame({
      playerCount: 3,
      seed: config.seed,
      ...(config.gameConfig || {}),
    });

    const history: SimulationResult['history'] = [];
    const maxTurns = config.maxTurns || 200;
    let stepCount = 0;
    const maxSteps = maxTurns * 3 * 3; // 固定三人，防止无限循环

    // 游戏主循环：每次迭代处理一个 AI 决策步骤
    while (!gameState.isGameOver && gameState.phase !== GamePhase.ENDED && stepCount++ < maxSteps) {
      // 如果处于 WAITING 或回合刚开始，进入摸牌阶段
      if (gameState.phase === GamePhase.WAITING || gameState.phase === undefined) {
        gameState = this.gm.nextTurn(gameState);
      }

      const currentPlayerIndex = gameState.phase === GamePhase.RESPONSE_COLLECTING && typeof gameState.responseWindow?.currentResponderIndex === 'number'
        ? gameState.responseWindow.currentResponderIndex
        : gameState.currentPlayerIndex;
      const currentPlayer = gameState.players[currentPlayerIndex];

      // 非AI玩家（人类），中断模拟等待外部输入
      if (!aiPlayers.includes(currentPlayerIndex)) {
        break;
      }

      const agent = this.aiAgents.get(currentPlayer.playerId);
      if (!agent) {
        gameState = this.gm.nextTurn(gameState);
        continue;
      }

      // 更新当前可用操作
      gameState = this.gm.updateAvailableActions(gameState);

      // 无可用操作时，进入下一回合
      if (gameState.availableActions.length === 0) {
        gameState = this.gm.nextTurn(gameState);
        continue;
      }

      // AI 决策
      const decisionState = currentPlayerIndex === gameState.currentPlayerIndex
        ? gameState
        : { ...gameState, currentPlayerIndex };
      const action = await agent.decide(decisionState);

      if (config.recordHistory) {
        history.push({
          state: { ...gameState },
          action
        });
      }

      // 执行动作
      const beforeSignature = `${gameState.phase}|${gameState.currentPlayerIndex}|${gameState.turnCount}|${gameState.responseWindow?.currentResponderIndex ?? 'none'}|${gameState.pendingResponses.length}`;
      gameState = this.gm.processAction(gameState, action);
      const afterSignature = `${gameState.phase}|${gameState.currentPlayerIndex}|${gameState.turnCount}|${gameState.responseWindow?.currentResponderIndex ?? 'none'}|${gameState.pendingResponses.length}`;

      // 非法/过期动作必须暴露为停滞，不能越过核心规则强制换家。
      if (!gameState.isGameOver && gameState.phase !== GamePhase.ENDED && beforeSignature === afterSignature) {
        break;
      }

      // 胡牌直接结束
      if (action.type === 'hu' || gameState.isGameOver || gameState.phase === GamePhase.ENDED) {
        break;
      }

    }

    // 确定最终结果
    const endCheck = this.gm.checkGameEnd(gameState);

    return {
      completed: gameState.isGameOver || gameState.phase === GamePhase.ENDED || endCheck.ended,
      winnerIndex: endCheck.winnerIndex,
      totalTurns: gameState.turnCount,
      history,
      scores: gameState.players.map(p => p.totalScore)
    };
  }

  /**
   * 运行多次模拟并收集统计数据
   */
  async runMultiple(config: SimulationConfig, count: number): Promise<GameStats> {
    const wins = new Array(config.playerCount).fill(0);
    const totalScores = new Array(config.playerCount).fill(0);
    let totalTurns = 0;

    for (let i = 0; i < count; i++) {
      const result = await this.simulate({
        ...config,
        seed: typeof config.seed === 'number' ? config.seed + i : undefined,
        recordHistory: false
      });

      if (result.winnerIndex !== undefined) {
        wins[result.winnerIndex]++;
      }

      result.scores.forEach((score, index) => {
        totalScores[index] += score;
      });

      totalTurns += result.totalTurns;
    }

    const winRates = wins.map(w => w / count);
    const averageScores = totalScores.map(s => s / count);
    const averageTurns = totalTurns / count;

    return {
      totalGames: count,
      wins,
      winRates,
      averageTurns,
      averageScores
    };
  }

  /**
   * 创建 AI 代理
   */
  private createAIAgents(config: SimulationConfig): void {
    this.aiAgents.clear();

    const aiPlayers = config.aiPlayers ?? Array.from({ length: config.playerCount }, (_, i) => i);

    for (const playerIndex of aiPlayers) {
      const playerId = `player_${playerIndex}`;
      const agent = new AIPlayerAgent(playerId, {
        mode: config.aiModeByPlayer?.[playerIndex] || 'medium',
      });
      this.aiAgents.set(playerId, agent);
    }
  }

  /**
   * 添加人类玩家操作
   */
  processHumanAction(state: GameState, action: PlayerAction): GameState {
    return this.gm.processAction(state, action);
  }

  /**
   * 为指定玩家刷新可用操作（用于响应阶段判定）
   */
  getStateForPlayer(state: GameState, playerIndex: number): GameState {
    const switched = {
      ...state,
      currentPlayerIndex: playerIndex
    };
    return this.gm.updateAvailableActions(switched);
  }

  /**
   * 获取游戏状态
   */
  getGameState(config: SimulationConfig): GameState {
    return this.gm.createGame({
      playerCount: 3,
      ...(config.gameConfig || {}),
    });
  }

  /**
   * 重置模拟器
   */
  reset(): void {
    this.aiAgents.clear();
  }
}

// 导出单例
export const gameSimulator = new GameSimulator();
