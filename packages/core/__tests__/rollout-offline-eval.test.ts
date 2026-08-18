import { describe, expect, it, vi } from 'vitest';
import type { PolicyArtifact } from '../src/shared/types/ai';
import {
  attachOracleToSamplesParallel,
  evaluateDiscardCandidatesWithRollouts,
  evaluateLearnedVsHeuristic,
  evaluatePolicyGate,
  sampleSelfPlayDiscardStates,
  summarizeOracleSignal,
  trainPolicyArtifactFromSamples,
  type OfflineSample,
} from '../src/ai/rollout-offline';
import { GameManager } from '../src/game-engine/game-manager';
import { AIAnalyzer } from '../src/ai/ai-analyzer';
import { AIPlayerAgent } from '../src/ai/ai-player-agent';
import { GamePhase } from '../src/shared/types';

const TEST_ARTIFACT: PolicyArtifact = {
  policyVersion: 'test-learned-v1',
  featureSchemaVersion: 'discard-v1',
  generatedAt: '2026-03-20T00:00:00.000Z',
  objective: 'dual_balanced',
  scoreWeights: {
    heuristic_priority: 1,
  },
};

function createSample(params: {
  sampleId: string;
  turnCount: number;
  remainingDeckCards: number;
  heuristicTopOption: string;
  learnedBest: string;
  heuristicWinRate: number;
  heuristicScore: number;
  learnedWinRate: number;
  learnedScore: number;
  oracleOrder?: Array<'learned' | 'heuristic'>;
}): OfflineSample {
  const lowCode = params.learnedBest === 'S1' ? 'S2' : 'S1';
  const learnedCandidate = {
    action: 'discard' as const,
    cards: [params.learnedBest],
    predictedWinRate: params.learnedWinRate,
    predictedExpectedScore: params.learnedScore,
    predictedScoreVariance: 0.2,
    futureMingTangPotential: 1,
    rolloutCount: 8,
  };
  const heuristicCandidate = {
    action: 'discard' as const,
    cards: [params.heuristicTopOption],
    predictedWinRate: params.heuristicWinRate,
    predictedExpectedScore: params.heuristicScore,
    predictedScoreVariance: 0.3,
    futureMingTangPotential: 0.5,
    rolloutCount: 8,
  };
  const oracleOrder = params.oracleOrder ?? ['learned', 'heuristic'];
  const orderedCandidates = oracleOrder
    .map((item) => (item === 'learned' ? learnedCandidate : heuristicCandidate));

  return {
    sampleId: params.sampleId,
    stateSignature: `${params.sampleId}_sig`,
    playerId: 'player_0',
    playerIndex: 0,
    turnCount: params.turnCount,
    phase: 'discarding',
    remainingDeckCards: params.remainingDeckCards,
    legalDiscards: ['S1', 'S2'],
    heuristicTopOption: params.heuristicTopOption,
    policyFeaturesByAction: {
      [params.learnedBest]: { heuristic_priority: 10 },
      [lowCode]: { heuristic_priority: 1 },
    },
    oracle: {
      sampleId: params.sampleId,
      policyVersion: 'oracle-rollout-v1',
      objectiveScore: 0,
      candidates: orderedCandidates,
    },
    state: {
      remainingDeckCards: params.remainingDeckCards,
    } as any,
    remainingDeck: [],
  };
}

describe('evaluateLearnedVsHeuristic', () => {
  it('summarizes low-signal oracle samples', () => {
    const samples: OfflineSample[] = [
      createSample({
        sampleId: 'signal-strong',
        turnCount: 4,
        remainingDeckCards: 16,
        heuristicTopOption: 'S2',
        learnedBest: 'S1',
        heuristicWinRate: 0.1,
        heuristicScore: 2,
        learnedWinRate: 0.7,
        learnedScore: 9,
      }),
      createSample({
        sampleId: 'signal-flat',
        turnCount: 5,
        remainingDeckCards: 15,
        heuristicTopOption: 'S2',
        learnedBest: 'S1',
        heuristicWinRate: 0.4,
        heuristicScore: 4,
        learnedWinRate: 0.4,
        learnedScore: 4,
      }),
    ];

    const summary = summarizeOracleSignal(samples, {
      winRateWeight: 100,
      expectedScoreWeight: 2.5,
      minObjectiveSpread: 0.1,
      minWinRateSpread: 0.01,
      minExpectedScoreSpread: 0.1,
    });

    expect(summary.totalSamples).toBe(2);
    expect(summary.lowSignalSamples).toBe(1);
    expect(summary.lowSignalRatio).toBe(0.5);
  });

  it('records filtering and pairwise training metadata', () => {
    const samples: OfflineSample[] = [
      createSample({
        sampleId: 'train-1',
        turnCount: 2,
        remainingDeckCards: 18,
        heuristicTopOption: 'S2',
        learnedBest: 'S1',
        heuristicWinRate: 0.1,
        heuristicScore: 1,
        learnedWinRate: 0.8,
        learnedScore: 10,
      }),
      createSample({
        sampleId: 'train-2',
        turnCount: 4,
        remainingDeckCards: 16,
        heuristicTopOption: 'S2',
        learnedBest: 'S1',
        heuristicWinRate: 0.2,
        heuristicScore: 2,
        learnedWinRate: 0.75,
        learnedScore: 9,
      }),
      createSample({
        sampleId: 'train-flat-1',
        turnCount: 6,
        remainingDeckCards: 14,
        heuristicTopOption: 'S2',
        learnedBest: 'S1',
        heuristicWinRate: 0.5,
        heuristicScore: 5,
        learnedWinRate: 0.5,
        learnedScore: 5,
      }),
      createSample({
        sampleId: 'train-flat-2',
        turnCount: 7,
        remainingDeckCards: 13,
        heuristicTopOption: 'S2',
        learnedBest: 'S1',
        heuristicWinRate: 0.45,
        heuristicScore: 4,
        learnedWinRate: 0.45,
        learnedScore: 4,
      }),
    ];

    const artifact = trainPolicyArtifactFromSamples(samples, TEST_ARTIFACT);
    expect(artifact.trainingMeta?.sampledDecisionCount).toBe(4);
    expect(artifact.trainingMeta?.retainedSampleCount).toBeGreaterThan(0);
    expect(artifact.trainingMeta?.filteredSampleCount).toBeGreaterThanOrEqual(0);
    expect(artifact.trainingMeta?.lowSignalSampleCount).toBeGreaterThanOrEqual(0);
    expect(artifact.trainingMeta?.pairwiseRowCount).toBeGreaterThanOrEqual(0);
  });

  it('records configurable sample balance metadata', () => {
    const samples = Array.from({ length: 12 }, (_, index) => createSample({
      sampleId: `balance-${index}`,
      turnCount: 3 + (index % 6),
      remainingDeckCards: 18 - (index % 4),
      heuristicTopOption: 'S2',
      learnedBest: 'S1',
      heuristicWinRate: 0.2,
      heuristicScore: 2,
      learnedWinRate: 0.8,
      learnedScore: 8,
    }));

    const artifact = trainPolicyArtifactFromSamples(samples, TEST_ARTIFACT, {
      maxResponseToDiscardRatio: 0.7,
      discardSampleWeight: 1.6,
      discardStageMinShare: 0.3,
      discardOpeningWeight: 1.9,
      openingHeuristicDisagreementWeight: 3.2,
      hardExampleWeight: 2.4,
    });

    expect(artifact.trainingMeta?.maxResponseToDiscardRatio).toBe(0.7);
    expect(artifact.trainingMeta?.discardSampleWeight).toBe(1.6);
    expect(artifact.trainingMeta?.discardStageMinShare).toBe(0.3);
    expect(artifact.trainingMeta?.discardOpeningWeight).toBe(1.9);
    expect(artifact.trainingMeta?.openingHeuristicDisagreementWeight).toBe(3.2);
    expect(artifact.trainingMeta?.hardExampleWeight).toBe(2.4);
    expect(artifact.trainingMeta?.monotonicConstraintVersion).toBe('harmful-features-nonpositive-v1');
    expect(artifact.scoreWeights.stable_structure_loss ?? 0).toBeLessThanOrEqual(0);
    expect(artifact.familyHeads?.discard?.scoreWeights?.stable_structure_loss ?? 0).toBeLessThanOrEqual(0);
  });

  it('treats opening heuristic-oracle disagreement as hard examples', () => {
    const samples: OfflineSample[] = [
      createSample({
        sampleId: 'opening-hard-1',
        turnCount: 2,
        remainingDeckCards: 18,
        heuristicTopOption: 'S2',
        learnedBest: 'S1',
        heuristicWinRate: 0.35,
        heuristicScore: 3,
        learnedWinRate: 0.6,
        learnedScore: 7,
      }),
      createSample({
        sampleId: 'opening-hard-2',
        turnCount: 3,
        remainingDeckCards: 17,
        heuristicTopOption: 'S2',
        learnedBest: 'S1',
        heuristicWinRate: 0.3,
        heuristicScore: 2,
        learnedWinRate: 0.58,
        learnedScore: 6.5,
      }),
    ];

    const artifact = trainPolicyArtifactFromSamples(samples, TEST_ARTIFACT);
    expect(artifact.trainingMeta?.hardExampleSampleCount).toBeGreaterThan(0);
  });

  it('falls back to the base artifact when validation does not beat baseline', () => {
    const samples: OfflineSample[] = [
      createSample({
        sampleId: 'fallback-1',
        turnCount: 2,
        remainingDeckCards: 18,
        heuristicTopOption: 'S2',
        learnedBest: 'S1',
        heuristicWinRate: 0.2,
        heuristicScore: 2,
        learnedWinRate: 0.8,
        learnedScore: 8,
      }),
      createSample({
        sampleId: 'fallback-2',
        turnCount: 3,
        remainingDeckCards: 17,
        heuristicTopOption: 'S2',
        learnedBest: 'S1',
        heuristicWinRate: 0.25,
        heuristicScore: 2.5,
        learnedWinRate: 0.75,
        learnedScore: 7.5,
      }),
      createSample({
        sampleId: 'fallback-3',
        turnCount: 4,
        remainingDeckCards: 16,
        heuristicTopOption: 'S2',
        learnedBest: 'S1',
        heuristicWinRate: 0.22,
        heuristicScore: 2.2,
        learnedWinRate: 0.78,
        learnedScore: 7.8,
      }),
    ];

    const artifact = trainPolicyArtifactFromSamples(samples, TEST_ARTIFACT);
    expect(artifact.policyVersion).toBe(TEST_ARTIFACT.policyVersion);
  });

  it('stops self-play sampling once maxSamples is reached', async () => {
    const samples = await sampleSelfPlayDiscardStates({
      selfPlayGames: 1,
      maxTurnsPerGame: 8,
      maxSamples: 1,
      samplePhase: 'discard',
      rolloutCountPerAction: 1,
      rolloutSeed: 20260331,
    });

    expect(samples).toHaveLength(1);
    expect(samples[0]?.phase).toBe(GamePhase.DISCARDING);
  });

  it('uses a single analyzer pass per sampled discard state', async () => {
    const analyzeSpy = vi.spyOn(AIAnalyzer.prototype, 'analyze');
    const decideSpy = vi.spyOn(AIPlayerAgent.prototype, 'decide').mockImplementation(async (state) => {
      const fallbackAction = state.availableActions?.find((action) => action.type === 'discard')
        || state.availableActions?.[0];
      if (!fallbackAction) {
        throw new Error('expected available action during sampling');
      }
      return {
        type: fallbackAction.type,
        playerId: fallbackAction.playerId,
        cards: fallbackAction.cards || [],
        chiOptionId: fallbackAction.chiOptions?.[0]?.id,
        huOptionId: fallbackAction.huOptions?.[0]?.id,
        timestamp: Date.now(),
      };
    });

    try {
      const samples = await sampleSelfPlayDiscardStates({
        selfPlayGames: 1,
        maxTurnsPerGame: 8,
        maxSamples: 1,
        samplePhase: 'discard',
        rolloutCountPerAction: 1,
        rolloutSeed: 20260331,
      });

      expect(samples).toHaveLength(1);
      expect(analyzeSpy).toHaveBeenCalledTimes(1);
    } finally {
      decideSpy.mockRestore();
      analyzeSpy.mockRestore();
    }
  });

  it('attaches oracle labels through worker parallelism on small sampled states', async () => {
    const samples = await sampleSelfPlayDiscardStates({
      selfPlayGames: 1,
      maxTurnsPerGame: 6,
      maxSamples: 1,
      samplePhase: 'discard',
      rolloutCountPerAction: 1,
      rolloutSeed: 20260414,
      oracleTopK: 1,
      maxRolloutSteps: 2,
    });

    expect(samples.length).toBeGreaterThan(0);

    const duplicatedSamples = [
      samples[0],
      {
        ...samples[0],
        sampleId: `${samples[0].sampleId}-parallel-copy`,
        stateSignature: `${samples[0].stateSignature}-parallel-copy`,
      },
    ];

    const labeled = await attachOracleToSamplesParallel(duplicatedSamples, {
      selfPlayGames: 1,
      maxTurnsPerGame: 6,
      maxSamples: 2,
      samplePhase: 'discard',
      rolloutCountPerAction: 1,
      rolloutSeed: 20260414,
      oracleTopK: 1,
      maxRolloutSteps: 2,
      oracleParallelism: 2,
    });

    expect(labeled).toHaveLength(duplicatedSamples.length);
    expect(labeled.every((sample) => Array.isArray(sample.oracle?.candidates) && sample.oracle!.candidates.length > 0)).toBe(true);
    expect(labeled.every((sample) => sample.oracle?.candidates.every((candidate) => candidate.rolloutCount >= 0))).toBe(true);
  }, 20000);

  it('uses snake_case heuristic priority for oracle topK pruning', async () => {
    const samples = await sampleSelfPlayDiscardStates({
      selfPlayGames: 1,
      maxTurnsPerGame: 6,
      maxSamples: 1,
      samplePhase: 'discard',
      rolloutCountPerAction: 1,
      rolloutSeed: 20260415,
      maxRolloutSteps: 2,
    });
    const sample = samples[0];
    expect(sample.legalDiscards.length).toBeGreaterThan(1);
    const preferred = sample.legalDiscards[1];
    sample.policyFeaturesByAction = Object.fromEntries(
      sample.legalDiscards.map((code) => [code, {
        ...(sample.policyFeaturesByAction?.[code] || {}),
        heuristic_priority: code === preferred ? 1000 : 0,
      }]),
    );

    const oracle = await evaluateDiscardCandidatesWithRollouts(sample, {
      selfPlayGames: 1,
      maxTurnsPerGame: 6,
      maxSamples: 1,
      samplePhase: 'discard',
      rolloutCountPerAction: 1,
      rolloutSeed: 20260415,
      oracleTopK: 1,
      maxRolloutSteps: 2,
    });

    const rolledOut = oracle.candidates.filter((candidate) => candidate.rolloutCount > 0);
    expect(rolledOut).toHaveLength(1);
    expect(rolledOut[0].cards?.[0]).toBe(preferred);
  }, 20000);

  it('limits response-heavy samples during training selection', () => {
    const discardA = createSample({
      sampleId: 'balance-discard-1',
      turnCount: 4,
      remainingDeckCards: 16,
      heuristicTopOption: 'S2',
      learnedBest: 'S1',
      heuristicWinRate: 0.2,
      heuristicScore: 2,
      learnedWinRate: 0.7,
      learnedScore: 9,
    });
    const discardB = createSample({
      sampleId: 'balance-discard-2',
      turnCount: 5,
      remainingDeckCards: 15,
      heuristicTopOption: 'S2',
      learnedBest: 'S1',
      heuristicWinRate: 0.25,
      heuristicScore: 2.5,
      learnedWinRate: 0.68,
      learnedScore: 8.5,
    });
    const responseSamples: OfflineSample[] = Array.from({ length: 8 }, (_, index) => ({
      sampleId: `balance-response-${index}`,
      stateSignature: `balance_response_sig_${index}`,
      playerId: 'player_0',
      playerIndex: 0,
      turnCount: 8,
      phase: 'response_collecting',
      remainingDeckCards: 12,
      legalDiscards: ['pass', `peng:S${index + 1},S${index + 1},S${index + 1}`],
      heuristicTopOption: 'pass',
      policyFeaturesByAction: {
        pass: { heuristic_priority: 1 },
        [`peng:S${index + 1},S${index + 1},S${index + 1}`]: { heuristic_priority: 10 },
      },
      oracle: {
        sampleId: `balance-response-${index}`,
        policyVersion: 'oracle-rollout-v1',
        objectiveScore: 0,
        candidates: [
          {
            action: 'discard',
            cards: [`peng:S${index + 1},S${index + 1},S${index + 1}`],
            predictedWinRate: 0.72,
            predictedExpectedScore: 8,
            predictedScoreVariance: 0.3,
            futureMingTangPotential: 1.1,
            rolloutCount: 6,
          },
          {
            action: 'discard',
            cards: ['pass'],
            predictedWinRate: 0.2,
            predictedExpectedScore: 2,
            predictedScoreVariance: 0.1,
            futureMingTangPotential: 0.2,
            rolloutCount: 6,
          },
        ],
      },
      state: {} as any,
      remainingDeck: [],
    }));

    const samples = [discardA, discardB, ...responseSamples];
    const artifact = trainPolicyArtifactFromSamples(samples, TEST_ARTIFACT);
    expect(artifact.trainingMeta?.sampledDecisionCount).toBe(samples.length);
    expect(artifact.trainingMeta?.retainedSampleCount).toBeLessThan(samples.length);
    expect(artifact.trainingMeta?.retainedSampleCount).toBe(4);
  });

  it('retains discard stage coverage when low-signal filtering would otherwise collapse to one stage', () => {
    const withStructuralCoverage = (sample: OfflineSample): OfflineSample => ({
      ...sample,
      policyFeaturesByAction: Object.fromEntries(
        Object.entries(sample.policyFeaturesByAction || {}).map(([code, features]) => [code, {
          ...features,
          wait_count: code === 'S1' ? 3 : 1,
          speed_score: code === 'S1' ? 1 : 0.4,
          viable_sequence_templates: code === 'S1' ? 2 : 1,
        }]),
      ),
    });
    const endgameSamples = Array.from({ length: 96 }, (_, index) => withStructuralCoverage(createSample({
      sampleId: `stage-end-${index}`,
      turnCount: 16,
      remainingDeckCards: 7,
      heuristicTopOption: 'S2',
      learnedBest: 'S1',
      heuristicWinRate: 0.2,
      heuristicScore: 2,
      learnedWinRate: 0.8,
      learnedScore: 9,
    })));
    const openingSamples = Array.from({ length: 12 }, (_, index) => withStructuralCoverage(createSample({
      sampleId: `stage-open-${index}`,
      turnCount: 2,
      remainingDeckCards: 18,
      heuristicTopOption: 'S2',
      learnedBest: 'S1',
      heuristicWinRate: 0.4,
      heuristicScore: 4,
      learnedWinRate: 0.401,
      learnedScore: 4,
    })));
    const midgameSamples = Array.from({ length: 12 }, (_, index) => withStructuralCoverage(createSample({
      sampleId: `stage-mid-${index}`,
      turnCount: 6,
      remainingDeckCards: 14,
      heuristicTopOption: 'S2',
      learnedBest: 'S1',
      heuristicWinRate: 0.45,
      heuristicScore: 4.5,
      learnedWinRate: 0.451,
      learnedScore: 4.5,
    })));

    const weakBaseArtifact: PolicyArtifact = {
      ...TEST_ARTIFACT,
      policyVersion: 'weak-base-v1',
      scoreWeights: {
        heuristic_priority: -1,
      },
      predictionWeights: {
        winRate: {
          heuristic_priority: -1,
        },
        expectedScore: {
          heuristic_priority: -1,
        },
      },
      predictionBias: {
        winRate: 0,
        expectedScore: 0,
      },
      predictionTargetStats: {
        winRate: { mean: 0.5, std: 0.1 },
        expectedScore: { mean: 5, std: 1 },
      },
    };

    const artifact = trainPolicyArtifactFromSamples(
      [...endgameSamples, ...openingSamples, ...midgameSamples],
      weakBaseArtifact,
    );

    expect(artifact.trainingMeta?.retainedSampleCount).toBe(96);
    expect(artifact.familyHeads?.discard?.stageAdjustments?.opening?.sampleCount).toBeGreaterThan(0);
    expect(artifact.familyHeads?.discard?.stageAdjustments?.midgame?.sampleCount).toBeGreaterThan(0);
    expect(artifact.familyHeads?.discard?.stageAdjustments?.endgame?.sampleCount).toBeGreaterThan(0);
  });

  it('builds benchmark summary with sample counts and oracle match rates', () => {
    const samples: OfflineSample[] = [
      createSample({
        sampleId: 'opening-1',
        turnCount: 2,
        remainingDeckCards: 18,
        heuristicTopOption: 'S2',
        learnedBest: 'S1',
        heuristicWinRate: 0.3,
        heuristicScore: 3,
        learnedWinRate: 0.8,
        learnedScore: 9,
      }),
      createSample({
        sampleId: 'endgame-1',
        turnCount: 12,
        remainingDeckCards: 8,
        heuristicTopOption: 'S2',
        learnedBest: 'S1',
        heuristicWinRate: 0.2,
        heuristicScore: 2,
        learnedWinRate: 0.7,
        learnedScore: 8,
      }),
    ];

    const report = evaluateLearnedVsHeuristic(samples, TEST_ARTIFACT, {
      winRateWeight: 100,
      expectedScoreWeight: 2.5,
    });

    expect(report.policyVersion).toBe('test-learned-v1');
    expect(report.totalSamples).toBe(2);
    expect(report.winRateDelta).toBeGreaterThan(0);
    expect(report.expectedScoreDelta).toBeGreaterThan(0);
    expect(report.learnedOracleMatchRate).toBe(1);
    expect(report.heuristicOracleMatchRate).toBe(0);
    expect(report.benchmarkSummary).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'opening',
          sampleCount: 1,
          learnedOracleMatchRate: 1,
          heuristicOracleMatchRate: 0,
        }),
        expect.objectContaining({
          name: 'endgame',
          sampleCount: 1,
          learnedOracleMatchRate: 1,
          heuristicOracleMatchRate: 0,
        }),
      ]),
    );
  });

  it('supports non-discard action keys for response training samples', () => {
    const responseSample: OfflineSample = {
      sampleId: 'response-1',
      stateSignature: 'response_sig',
      playerId: 'player_0',
      playerIndex: 0,
      turnCount: 9,
      phase: 'response_collecting',
      remainingDeckCards: 11,
      legalDiscards: ['pass', 'peng:S4,S4,S4'],
      heuristicTopOption: 'pass',
      policyFeaturesByAction: {
        pass: { heuristic_priority: 1 },
        'peng:S4,S4,S4': { heuristic_priority: 10 },
      },
      oracle: {
        sampleId: 'response-1',
        policyVersion: 'oracle-rollout-v1',
        objectiveScore: 0,
        candidates: [
          {
            action: 'discard',
            cards: ['peng:S4,S4,S4'],
            predictedWinRate: 0.7,
            predictedExpectedScore: 8,
            predictedScoreVariance: 0.3,
            futureMingTangPotential: 1.1,
            rolloutCount: 6,
          },
          {
            action: 'discard',
            cards: ['pass'],
            predictedWinRate: 0.2,
            predictedExpectedScore: 2,
            predictedScoreVariance: 0.1,
            futureMingTangPotential: 0.2,
            rolloutCount: 6,
          },
        ],
      },
      state: {} as any,
      remainingDeck: [],
    };

    const report = evaluateLearnedVsHeuristic([responseSample], TEST_ARTIFACT, {
      winRateWeight: 100,
      expectedScoreWeight: 2.5,
    });

    expect(report.totalSamples).toBe(1);
    expect(report.winRateDelta).toBeGreaterThan(0);
    expect(report.expectedScoreDelta).toBeGreaterThan(0);
    expect(report.learnedOracleMatchRate).toBe(1);
    expect(report.heuristicOracleMatchRate).toBe(0);
  });

  it('emits action-family summary for discard and response samples', () => {
    const discardSample = createSample({
      sampleId: 'family-discard-1',
      turnCount: 3,
      remainingDeckCards: 18,
      heuristicTopOption: 'S2',
      learnedBest: 'S1',
      heuristicWinRate: 0.2,
      heuristicScore: 2,
      learnedWinRate: 0.7,
      learnedScore: 8,
    });
    const responseSample: OfflineSample = {
      sampleId: 'family-response-1',
      stateSignature: 'family_response_sig',
      playerId: 'player_0',
      playerIndex: 0,
      turnCount: 9,
      phase: 'response_collecting',
      remainingDeckCards: 11,
      legalDiscards: ['pass', 'peng:S4,S4,S4'],
      heuristicTopOption: 'pass',
      policyFeaturesByAction: {
        pass: { heuristic_priority: 1 },
        'peng:S4,S4,S4': { heuristic_priority: 10 },
      },
      oracle: {
        sampleId: 'family-response-1',
        policyVersion: 'oracle-rollout-v1',
        objectiveScore: 0,
        candidates: [
          {
            action: 'discard',
            cards: ['peng:S4,S4,S4'],
            predictedWinRate: 0.75,
            predictedExpectedScore: 8,
            predictedScoreVariance: 0.3,
            futureMingTangPotential: 1.1,
            rolloutCount: 6,
          },
          {
            action: 'discard',
            cards: ['pass'],
            predictedWinRate: 0.2,
            predictedExpectedScore: 2,
            predictedScoreVariance: 0.1,
            futureMingTangPotential: 0.2,
            rolloutCount: 6,
          },
        ],
      },
      state: {} as any,
      remainingDeck: [],
    };

    const report = evaluateLearnedVsHeuristic([discardSample, responseSample], TEST_ARTIFACT, {
      winRateWeight: 100,
      expectedScoreWeight: 2.5,
    });

    expect(report.actionFamilySummary).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'discard',
          sampleCount: 1,
          learnedOracleMatchRate: 1,
          heuristicOracleMatchRate: 0,
        }),
        expect.objectContaining({
          name: 'response',
          sampleCount: 1,
          learnedOracleMatchRate: 1,
          heuristicOracleMatchRate: 0,
        }),
      ]),
    );
  });

  it('sorts oracle candidates before computing oracle match', () => {
    const samples: OfflineSample[] = [
      createSample({
        sampleId: 'unsorted-1',
        turnCount: 5,
        remainingDeckCards: 15,
        heuristicTopOption: 'S2',
        learnedBest: 'S1',
        heuristicWinRate: 0.15,
        heuristicScore: 2,
        learnedWinRate: 0.65,
        learnedScore: 10,
        oracleOrder: ['heuristic', 'learned'],
      }),
    ];

    const report = evaluateLearnedVsHeuristic(samples, TEST_ARTIFACT, {
      winRateWeight: 100,
      expectedScoreWeight: 2.5,
    });

    expect(report.learnedOracleMatchRate).toBe(1);
    expect(report.heuristicOracleMatchRate).toBe(0);
    expect(report.benchmarkSummary).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          learnedTop: 'S1',
          heuristicTop: 'S2',
          oracleTop: 'S1',
        }),
      ]),
    );
  });

  it('requires remaining deck snapshot for replayed draw progression', () => {
    const liveGame = new GameManager();
    const initialState = liveGame.createGame({
      playerCount: 3,
      seed: 20260323,
    });
    const remainingDeck = liveGame.getRemainingDeckSnapshot();
    const currentPlayerIndex = initialState.currentPlayerIndex;
    const currentPlayer = initialState.players[currentPlayerIndex];
    const drawingState = {
      ...initialState,
      phase: GamePhase.DRAWING,
      remainingDeckCards: remainingDeck.length,
      availableActions: [],
      pendingResponses: [],
      pendingCardSource: undefined,
      discardPile: {
        ...initialState.discardPile,
        lastDiscard: undefined,
        lastDiscardPlayerIndex: undefined,
      },
      players: initialState.players.map((player, index) => index === currentPlayerIndex
        ? {
          ...player,
          cards: player.cards.slice(0, 20),
        }
        : player),
    };
    const drawAction = {
      type: 'draw' as const,
      playerId: currentPlayer.playerId,
      cards: [],
      timestamp: Date.now(),
    };

    const stalledGame = new GameManager();
    const stalledState = stalledGame.processAction(drawingState, drawAction);
    expect(stalledState.remainingDeckCards).toBe(remainingDeck.length);

    const replayGame = new GameManager();
    replayGame.setRemainingDeckSnapshot(remainingDeck);
    const advancedState = replayGame.processAction(drawingState, drawAction);
    expect(advancedState.remainingDeckCards).toBe(remainingDeck.length - 1);
    expect(advancedState.phase).toBe(GamePhase.RESPONSE_COLLECTING);
    expect(advancedState.discardPile.lastDiscard).toBeTruthy();
  });

  it('builds gate failure reasons from report thresholds', () => {
    const gate = evaluatePolicyGate({
      policyVersion: 'test-learned-v1',
      baselinePolicyVersion: 'heuristic-medium',
      benchmarkVersion: 'discard-holdout-v1',
      totalSamples: 0,
      winRateDelta: -0.02,
      expectedScoreDelta: -1,
      learnedOracleMatchRate: 0.1,
      heuristicOracleMatchRate: 0.25,
      benchmarkSummary: [],
    }, {
      minSamples: 2,
      minWinRateDelta: 0,
      minExpectedScoreDelta: 0,
      minLearnedOracleMatchRate: 0.2,
      minOracleMatchRateDelta: 0,
      minCategoryOracleMatchRateDelta: {
        midgame: 0,
      },
      requiredBenchmarkVersion: 'discard-holdout-v2',
    });

    expect(gate.passed).toBe(false);
    expect(gate.reasons).toEqual([
      'totalSamples 0 < minSamples 2',
      'winRateDelta -0.02 < minWinRateDelta 0',
      'expectedScoreDelta -1 < minExpectedScoreDelta 0',
      'learnedOracleMatchRate 0.1 < minLearnedOracleMatchRate 0.2',
      'oracleMatchRateDelta -0.15 < minOracleMatchRateDelta 0',
      'benchmarkSummary missing category midgame',
      'benchmarkVersion discard-holdout-v1 !== requiredBenchmarkVersion discard-holdout-v2',
    ]);
  });

  it('checks per-category oracle delta thresholds when benchmark summary exists', () => {
    const gate = evaluatePolicyGate({
      policyVersion: 'test-learned-v1',
      baselinePolicyVersion: 'heuristic-medium',
      benchmarkVersion: 'discard-holdout-v1',
      totalSamples: 10,
      winRateDelta: 0.01,
      expectedScoreDelta: 0.5,
      learnedOracleMatchRate: 0.3,
      heuristicOracleMatchRate: 0.2,
      benchmarkSummary: [
        {
          name: 'opening',
          sampleCount: 3,
          learnedTop: 'S1',
          heuristicTop: 'S2',
          oracleTop: 'S1',
          winRateDelta: 0,
          expectedScoreDelta: 0,
          learnedOracleMatchRate: 0.33,
          heuristicOracleMatchRate: 0.33,
        },
        {
          name: 'midgame',
          sampleCount: 3,
          learnedTop: 'S1',
          heuristicTop: 'S2',
          oracleTop: 'S1',
          winRateDelta: -0.05,
          expectedScoreDelta: -0.2,
          learnedOracleMatchRate: 0,
          heuristicOracleMatchRate: 0.33,
        },
        {
          name: 'endgame',
          sampleCount: 4,
          learnedTop: 'S1',
          heuristicTop: 'S2',
          oracleTop: 'S1',
          winRateDelta: 0.1,
          expectedScoreDelta: 0.4,
          learnedOracleMatchRate: 0.75,
          heuristicOracleMatchRate: 0.5,
        },
      ],
    }, {
      minSamples: 1,
      minWinRateDelta: 0,
      minExpectedScoreDelta: 0,
      minCategoryOracleMatchRateDelta: {
        opening: 0,
        midgame: -0.2,
        endgame: 0,
      },
      requiredBenchmarkVersion: 'discard-holdout-v1',
    });

    expect(gate.passed).toBe(false);
    expect(gate.reasons).toEqual([
      'categoryOracleMatchRateDelta midgame -0.33 < minCategoryOracleMatchRateDelta -0.2',
    ]);
  });

  it('allows mild expected score regression when win rate meets threshold', () => {
    const gate = evaluatePolicyGate({
      policyVersion: 'test-learned-v1',
      baselinePolicyVersion: 'heuristic-medium',
      benchmarkVersion: 'discard-holdout-v1',
      totalSamples: 320,
      winRateDelta: 0.006,
      expectedScoreDelta: -0.03,
      learnedOracleMatchRate: 0.22,
      heuristicOracleMatchRate: 0.2,
      benchmarkSummary: [],
    }, {
      minSamples: 300,
      minWinRateDelta: 0.005,
      minExpectedScoreDelta: -0.05,
      minLearnedOracleMatchRate: 0.18,
    });

    expect(gate.passed).toBe(true);
    expect(gate.reasons).toEqual([]);
  });

  it('fails when learned oracle match rate is below floor even if win rate passes', () => {
    const gate = evaluatePolicyGate({
      policyVersion: 'test-learned-v1',
      baselinePolicyVersion: 'heuristic-medium',
      benchmarkVersion: 'discard-holdout-v1',
      totalSamples: 320,
      winRateDelta: 0.01,
      expectedScoreDelta: 0.02,
      learnedOracleMatchRate: 0.15,
      heuristicOracleMatchRate: 0.14,
      benchmarkSummary: [],
    }, {
      minSamples: 300,
      minWinRateDelta: 0.005,
      minExpectedScoreDelta: -0.05,
      minLearnedOracleMatchRate: 0.18,
    });

    expect(gate.passed).toBe(false);
    expect(gate.reasons).toEqual([
      'learnedOracleMatchRate 0.15 < minLearnedOracleMatchRate 0.18',
    ]);
  });

  it('fails when opening or midgame winRateDelta falls below stage floor', () => {
    const gate = evaluatePolicyGate({
      policyVersion: 'test-learned-v1',
      baselinePolicyVersion: 'heuristic-medium',
      benchmarkVersion: 'discard-holdout-v1',
      totalSamples: 320,
      winRateDelta: 0.008,
      expectedScoreDelta: 0,
      learnedOracleMatchRate: 0.2,
      heuristicOracleMatchRate: 0.16,
      benchmarkSummary: [
        {
          name: 'opening',
          sampleCount: 100,
          learnedTop: 'S1',
          heuristicTop: 'S2',
          oracleTop: 'S1',
          winRateDelta: -0.01,
          expectedScoreDelta: -0.05,
          learnedOracleMatchRate: 0.25,
          heuristicOracleMatchRate: 0.23,
        },
        {
          name: 'midgame',
          sampleCount: 120,
          learnedTop: 'S1',
          heuristicTop: 'S2',
          oracleTop: 'S1',
          winRateDelta: 0.02,
          expectedScoreDelta: 0.1,
          learnedOracleMatchRate: 0.21,
          heuristicOracleMatchRate: 0.19,
        },
        {
          name: 'endgame',
          sampleCount: 100,
          learnedTop: 'S1',
          heuristicTop: 'S2',
          oracleTop: 'S1',
          winRateDelta: 0.015,
          expectedScoreDelta: 0.08,
          learnedOracleMatchRate: 0.19,
          heuristicOracleMatchRate: 0.15,
        },
      ],
    }, {
      minSamples: 300,
      minWinRateDelta: 0.005,
      minExpectedScoreDelta: -0.05,
      minLearnedOracleMatchRate: 0.18,
      minCategoryWinRateDelta: {
        opening: 0,
        midgame: 0,
      },
    });

    expect(gate.passed).toBe(false);
    expect(gate.reasons).toEqual([
      'categoryWinRateDelta opening -0.01 < minCategoryWinRateDelta 0',
    ]);
  });

  it('checks per-action-family oracle delta thresholds when action family summary exists', () => {
    const gate = evaluatePolicyGate({
      policyVersion: 'test-learned-v1',
      baselinePolicyVersion: 'heuristic-medium',
      benchmarkVersion: 'discard-holdout-v1',
      totalSamples: 8,
      winRateDelta: 0.01,
      expectedScoreDelta: 0.3,
      learnedOracleMatchRate: 0.5,
      heuristicOracleMatchRate: 0.25,
      benchmarkSummary: [],
      actionFamilySummary: [
        {
          name: 'discard',
          sampleCount: 5,
          winRateDelta: 0.02,
          expectedScoreDelta: 0.4,
          learnedOracleMatchRate: 0.6,
          heuristicOracleMatchRate: 0.4,
        },
        {
          name: 'response',
          sampleCount: 3,
          winRateDelta: -0.01,
          expectedScoreDelta: -0.2,
          learnedOracleMatchRate: 0.3,
          heuristicOracleMatchRate: 0.5,
        },
      ],
    }, {
      minSamples: 1,
      minWinRateDelta: 0,
      minExpectedScoreDelta: 0,
      minActionFamilyOracleMatchRateDelta: {
        discard: 0,
        response: 0,
      },
    });

    expect(gate.passed).toBe(false);
    expect(gate.reasons).toEqual([
      'actionFamilyOracleMatchRateDelta response -0.2 < minActionFamilyOracleMatchRateDelta 0',
    ]);
  });

  it('checks per-action-family win-rate thresholds when action family summary exists', () => {
    const gate = evaluatePolicyGate({
      policyVersion: 'test-learned-v1',
      baselinePolicyVersion: 'heuristic-medium',
      benchmarkVersion: 'discard-holdout-v1',
      totalSamples: 8,
      winRateDelta: 0.01,
      expectedScoreDelta: 0.3,
      learnedOracleMatchRate: 0.5,
      heuristicOracleMatchRate: 0.25,
      benchmarkSummary: [],
      actionFamilySummary: [
        {
          name: 'discard',
          sampleCount: 5,
          winRateDelta: -0.001,
          expectedScoreDelta: 0.4,
          learnedOracleMatchRate: 0.6,
          heuristicOracleMatchRate: 0.4,
        },
        {
          name: 'response',
          sampleCount: 3,
          winRateDelta: 0.02,
          expectedScoreDelta: -0.2,
          learnedOracleMatchRate: 0.3,
          heuristicOracleMatchRate: 0.5,
        },
      ],
    }, {
      minSamples: 1,
      minWinRateDelta: 0,
      minExpectedScoreDelta: 0,
      minActionFamilyWinRateDelta: {
        discard: 0,
      },
    });

    expect(gate.passed).toBe(false);
    expect(gate.reasons).toEqual([
      'actionFamilyWinRateDelta discard -0.001 < minActionFamilyWinRateDelta 0',
    ]);
  });

  it('does not fail on missing action family when threshold is non-positive', () => {
    const gate = evaluatePolicyGate({
      policyVersion: 'test-learned-v1',
      baselinePolicyVersion: 'heuristic-medium',
      benchmarkVersion: 'discard-holdout-v1',
      totalSamples: 8,
      winRateDelta: 0.01,
      expectedScoreDelta: 0.3,
      learnedOracleMatchRate: 0.5,
      heuristicOracleMatchRate: 0.25,
      benchmarkSummary: [],
      actionFamilySummary: [
        {
          name: 'discard',
          sampleCount: 8,
          winRateDelta: 0.02,
          expectedScoreDelta: 0.4,
          learnedOracleMatchRate: 0.6,
          heuristicOracleMatchRate: 0.4,
        },
      ],
    }, {
      minSamples: 1,
      minWinRateDelta: 0,
      minExpectedScoreDelta: 0,
      minActionFamilyOracleMatchRateDelta: {
        discard: -0.02,
        response: -0.03,
      },
    });

    expect(gate.passed).toBe(true);
    expect(gate.reasons).toEqual([]);
  });
});
