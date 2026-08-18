/**
 * 游戏核心功能测试
 * 验证牌组、发牌、游戏管理器的基本功能
 */

import { describe, it, expect } from 'vitest';
import { GameSimulator } from '../src/game-engine/simulator';
import { SimulationConfig } from '../src/shared/types/simulation';
import { GameManager } from '../src/game-engine/game-manager';
import { DeckManager } from '../src/game-engine/deck-manager';

describe('游戏模拟核心功能', () => {
  describe('DeckManager', () => {
    const deckManager = new DeckManager();

    it('应该能创建80张牌', () => {
      const deck = deckManager.createDeck();
      expect(deck).toHaveLength(80);
    });

    it('洗牌后应该改变牌的顺序', () => {
      const deck1 = deckManager.createDeck();
      const deck2 = deckManager.shuffle(deck1);

      let movedCount = 0;
      for (let i = 0; i < deck1.length; i++) {
        if (deck1[i].id !== deck2[i].id) {
          movedCount++;
        }
      }
      expect(movedCount).toBeGreaterThan(0);
    });

    it('发牌后应该分配正确的牌数', () => {
      const deck = deckManager.createShuffledDeck();
      const dealResult = deckManager.deal(deck, 3, 0);

      expect(dealResult.hands).toHaveLength(3);
      expect(dealResult.hands[0]).toHaveLength(21); // 庄家
      expect(dealResult.hands[1]).toHaveLength(20);
      expect(dealResult.hands[2]).toHaveLength(20);
      expect(dealResult.remainingDeck).toHaveLength(17);
    });
  });

  describe('GameManager', () => {
    const gameManager = new GameManager();

    it('应该能创建游戏状态', () => {
      const gameState = gameManager.createGame({
        playerCount: 3
      });

      expect(gameState).toBeDefined();
      expect(gameState.players).toHaveLength(3);
      expect(gameState.isGameOver).toBe(false);
      expect(['discarding', 'bao_selection']).toContain(gameState.phase);
    });

    it('发牌后每个玩家应该有正确的牌数', () => {
      const gameState = gameManager.createGame({
        playerCount: 3
      });

      const total0 = gameState.players[0].cards.length + gameState.players[0].melds.reduce((s, m) => s + m.cards.length, 0);
      const total1 = gameState.players[1].cards.length + gameState.players[1].melds.reduce((s, m) => s + m.cards.length, 0);
      const total2 = gameState.players[2].cards.length + gameState.players[2].melds.reduce((s, m) => s + m.cards.length, 0);

      // 爆牌选择阶段庄家基础手牌为20张，第21张牌单独保存在 dealerPendingCard；
      // 若没有爆牌选择，则 pending 已按开局流程并入庄家手牌。
      expect(total0).toBe(gameState.phase === 'bao_selection' ? 20 : 21);
      expect(total1).toBe(20);
      expect(total2).toBe(20);
      if (gameState.phase === 'bao_selection') {
        expect(gameState.dealerPendingCard).toBeDefined();
      }
    });

    it('应该有正确的牌堆剩余数量', () => {
      const gameState = gameManager.createGame({
        playerCount: 3
      });

      expect(gameState.remainingDeckCards).toBe(17);
    });

    it('3人游戏应该有正确的牌数分配', () => {
      const gameState = gameManager.createGame({
        playerCount: 3
      });

      expect(gameState.players).toHaveLength(3);
      const totals = gameState.players.map(p => p.cards.length + p.melds.reduce((s, m) => s + m.cards.length, 0));
      expect(totals[0]).toBe(21);
      expect(totals[1]).toBe(20);
      expect(totals[2]).toBe(20);
    });
  });

  describe('游戏规则验证', () => {
    const gameManager = new GameManager();

    it('牌组应该包含正确的牌面', () => {
      const gameState = gameManager.createGame({
        playerCount: 3
      });

      const totalCards = gameState.players.reduce(
        (sum, player) => sum + player.cards.length + player.melds.reduce((s, m) => s + m.cards.length, 0),
        0
      );

      expect(totalCards).toBe(61); // 21 + 20 + 20
    });

    it('庄家应该是第一个玩家', () => {
      const gameState = gameManager.createGame({
        playerCount: 3
      });

      expect(gameState.players[0].isDealer).toBe(true);
      expect(gameState.players[0].isCurrentPlayer).toBe(true);
    });
  });

  describe('游戏模拟（基础）', () => {
    const simulator = new GameSimulator();

    it('应该能获取游戏状态', () => {
      const config: SimulationConfig = {
        playerCount: 3,
        aiPlayers: [],
        recordHistory: false
      };

      const gameState = simulator.getGameState(config);

      expect(gameState).toBeDefined();
      expect(gameState.players).toHaveLength(3);
    });
  });
});
