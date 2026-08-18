import type { AIDecisionEvidence, AIPlayRecommendation, AITeachingTag } from './types';

interface BuildExplanationInput {
  action: AIPlayRecommendation['action'];
  posture?: AIPlayRecommendation['posture'];
  evidence?: AIDecisionEvidence;
  fallbackSummary?: string;
  fallbackPoints?: string[];
}

export class AIExplanationEngine {
  private readonly tagLabels: Record<AITeachingTag, string> = {
    speed: '提速',
    ukeire: '进张',
    score: '冲分',
    risk: '避险',
    shape: '牌效',
    timing: '时机',
    flexibility: '弹性',
  };

  buildExplanation(input: BuildExplanationInput): { summary: string; keyPoints: string[] } {
    const summary = input.fallbackSummary || this.buildSummary(input.action, input.posture, input.evidence);
    const keyPoints = this.mergePoints(input.evidence, input.fallbackPoints || []);
    return {
      summary,
      keyPoints: keyPoints.slice(0, 4),
    };
  }

  private buildSummary(
    action: AIPlayRecommendation['action'],
    posture?: AIPlayRecommendation['posture'],
    evidence?: AIDecisionEvidence,
  ): string {
    if (action === 'discard') {
      if (posture === 'attack') return '这张是当前最适合的提速舍张';
      if (posture === 'defense') return '这张是当前更适合先处理的风险牌';
      return '这张最不伤主干，适合当前整理节奏';
    }

    if (action === 'hu') return '收益已经成熟，先把确定分数收下';
    if (action === 'pass') return '先过不是放弃，而是在保留后续路线';

    if ((evidence?.tempoGain || 0) > 0.5) {
      return '这步能明显改善节奏，属于主动提速的操作';
    }
    if ((evidence?.scorePotential || 0) >= 10) {
      return '这步更偏向立分和冲档，收益比较直接';
    }
    if ((evidence?.dangerScore || 0) >= 60) {
      return '这步要兼顾安全，不能只看眼前能不能成一组';
    }

    return '这步主要是在整理结构，争取把后续路线做顺';
  }

  private mergePoints(evidence?: AIDecisionEvidence, fallbackPoints: string[] = []): string[] {
    const points: string[] = [];

    for (const signal of evidence?.signals || []) {
      if (signal && !points.includes(signal)) {
        points.push(signal);
      }
    }

    const tags = evidence?.tags || [];
    if (tags.length > 0) {
      const tagLine = `教学重点：${tags.map((tag) => this.tagLabels[tag]).join('、')}`;
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
}