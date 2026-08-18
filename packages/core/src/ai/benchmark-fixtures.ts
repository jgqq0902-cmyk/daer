import type { PolicyEvaluationSample, SelfPlayDatasetSample } from '../shared/types/ai';

export type BenchmarkCategory = 'opening' | 'midgame' | 'endgame';

export const DEFAULT_BENCHMARK_CORPUS_VERSION = 'discard-holdout-v2';
const DEFAULT_WIN_RATE_WEIGHT = 100;
const DEFAULT_EXPECTED_SCORE_WEIGHT = 2.5;

export interface BenchmarkFixture {
  id: string;
  category: BenchmarkCategory;
  description: string;
  sampleId: string;
}

export interface BenchmarkFixtureSet {
  version: string;
  generatedAt: string;
  fixtures: BenchmarkFixture[];
}

export interface BenchmarkCorpusFile {
  version: string;
  generatedAt: string;
  source: 'selfplay-holdout';
  config: {
    seed: number;
    selfPlayGames: number;
    maxTurnsPerGame: number;
    maxSamples: number;
    rolloutCountPerAction: number;
    maxRolloutSteps: number;
    maxPerCategory: number;
  };
  fixtures: BenchmarkFixture[];
  samples: PolicyEvaluationSample[];
}

function objectiveScore(sample: PolicyEvaluationSample, index: number): number {
  const candidate = sample.oracle?.candidates?.[index];
  if (!candidate) {
    return 0;
  }
  return candidate.predictedWinRate * DEFAULT_WIN_RATE_WEIGHT
    + candidate.predictedExpectedScore * DEFAULT_EXPECTED_SCORE_WEIGHT;
}

function getSampleSignal(sample: SelfPlayDatasetSample): number {
  const policySample = sample as PolicyEvaluationSample;
  const candidates = policySample.oracle?.candidates || [];
  if (candidates.length < 2) {
    return 0;
  }
  const sortedIndexes = candidates
    .map((_, index) => index)
    .sort((left, right) => objectiveScore(policySample, right) - objectiveScore(policySample, left));
  const top = objectiveScore(policySample, sortedIndexes[0]);
  const second = objectiveScore(policySample, sortedIndexes[1]);
  return Math.max(0, top - second);
}

export function inferBenchmarkCategoryFromSample(sample: SelfPlayDatasetSample): BenchmarkCategory {
  if (sample.turnCount <= 4) {
    return 'opening';
  }
  const remainingDeckCards = Number((sample as Partial<PolicyEvaluationSample>).remainingDeckCards);
  if ((Number.isFinite(remainingDeckCards) && remainingDeckCards <= 10) || sample.turnCount >= 12) {
    return 'endgame';
  }
  return 'midgame';
}

export function buildBenchmarkFixturesFromSamples(
  samples: SelfPlayDatasetSample[],
  maxPerCategory = 20,
): BenchmarkFixtureSet {
  const grouped = new Map<BenchmarkCategory, SelfPlayDatasetSample[]>();
  const fixtures: BenchmarkFixture[] = [];

  for (const sample of samples) {
    const category = inferBenchmarkCategoryFromSample(sample);
    const list = grouped.get(category) || [];
    list.push(sample);
    grouped.set(category, list);
  }

  for (const category of ['opening', 'midgame', 'endgame'] as const) {
    const ranked = [...(grouped.get(category) || [])]
      .sort((left, right) => getSampleSignal(right) - getSampleSignal(left)
        || right.turnCount - left.turnCount
        || left.sampleId.localeCompare(right.sampleId))
      .slice(0, maxPerCategory);

    ranked.forEach((sample, index) => {
      fixtures.push({
        id: `${category}_${index + 1}`,
        category,
        description: `Auto sampled ${category} discard decision`,
        sampleId: sample.sampleId,
      });
    });
  }

  return {
    version: DEFAULT_BENCHMARK_CORPUS_VERSION,
    generatedAt: new Date().toISOString(),
    fixtures,
  };
}

export function selectSamplesByBenchmarkFixtures(
  samples: PolicyEvaluationSample[],
  fixtureSet: BenchmarkFixtureSet,
): PolicyEvaluationSample[] {
  const sampleIds = new Set(fixtureSet.fixtures.map((fixture) => fixture.sampleId));
  return samples.filter((sample) => sampleIds.has(sample.sampleId));
}
