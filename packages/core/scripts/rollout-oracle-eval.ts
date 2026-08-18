import type {
  RolloutEvaluationCandidate,
  RolloutEvaluationResult,
  SelfPlayDatasetSample,
} from '../src/shared/types/ai';
import { createSeededRng, hashString, parseArgs, readJsonFile, writeJsonFile } from './_common';

interface SelfPlayDatasetFile {
  version: string;
  generatedAt: string;
  samples: SelfPlayDatasetSample[];
}

interface OracleDatasetFile extends SelfPlayDatasetFile {
  oracleMeta: {
    evaluator: 'proxy_rollout_v1';
    rolloutCountPerAction: number;
    seed: number;
  };
}

function getArgNumber(value: string | number | boolean | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function getArgString(value: string | number | boolean | undefined, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function buildOracleForSample(
  sample: SelfPlayDatasetSample,
  baseSeed: number,
  rolloutCountPerAction: number,
): RolloutEvaluationResult {
  const candidates: RolloutEvaluationCandidate[] = sample.legalDiscards.map((code, index) => {
    const features = sample.policyFeaturesByAction?.[code] || {};
    const rng = createSeededRng(baseSeed + hashString(`${sample.sampleId}:${code}:${index}`));
    const scores: number[] = [];
    const winRates: number[] = [];

    const featureBase =
      (features.speed_score || 0) * 0.15
      + (features.ukeire_score || 0) * 0.2
      + (features.response_value || 0) * 0.18
      + (features.gui_value || 0) * 0.1
      - Math.abs(features.danger_score || 0) * 0.06
      - Math.abs(features.stable_structure_loss || 0) * 0.24;

    for (let rolloutIndex = 0; rolloutIndex < rolloutCountPerAction; rolloutIndex += 1) {
      const noise = (rng() - 0.5) * 0.15;
      const winRate = clamp(0.42 + featureBase * 0.015 + noise, 0.01, 0.99);
      const expectedScore = Math.max(0, 5 + featureBase * 0.7 + (rng() - 0.5) * 2.5);
      winRates.push(winRate);
      scores.push(expectedScore);
    }

    const avgWinRate = winRates.reduce((sum, item) => sum + item, 0) / winRates.length;
    const avgScore = scores.reduce((sum, item) => sum + item, 0) / scores.length;
    const variance = scores.reduce((sum, item) => sum + (item - avgScore) ** 2, 0) / scores.length;
    const futureMingTangPotential = Math.max(0, (features.gui_value || 0) + (features.score_bonus || 0) * 0.5);

    return {
      action: 'discard',
      cards: [code],
      predictedWinRate: Number(avgWinRate.toFixed(4)),
      predictedExpectedScore: Number(avgScore.toFixed(4)),
      predictedScoreVariance: Number(variance.toFixed(4)),
      futureMingTangPotential: Number(futureMingTangPotential.toFixed(4)),
      rolloutCount: rolloutCountPerAction,
    };
  });

  candidates.sort(
    (left, right) => right.predictedWinRate - left.predictedWinRate
      || right.predictedExpectedScore - left.predictedExpectedScore,
  );
  const top = candidates[0];

  return {
    sampleId: sample.sampleId,
    policyVersion: 'proxy-rollout-v1',
    objectiveScore: top ? top.predictedWinRate * 100 + top.predictedExpectedScore : 0,
    candidates,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const datasetPath = getArgString(args.dataset, 'artifacts/selfplay-dataset.json');
  const outputPath = getArgString(args.out, 'artifacts/selfplay-dataset.oracle.json');
  const seed = getArgNumber(args.seed, 20260319);
  const rolloutCount = getArgNumber(args.rollouts, 24);

  const dataset = readJsonFile<SelfPlayDatasetFile>(datasetPath);
  const enrichedSamples = dataset.samples.map((sample, index) => {
    if ((index + 1) % 100 === 0 || index + 1 === dataset.samples.length) {
      console.log(`[oracle] progress ${index + 1}/${dataset.samples.length} samples`);
    }
    return {
      ...sample,
      oracle: buildOracleForSample(sample, seed, rolloutCount),
    };
  });

  const output: OracleDatasetFile = {
    ...dataset,
    samples: enrichedSamples,
    oracleMeta: {
      evaluator: 'proxy_rollout_v1',
      rolloutCountPerAction: rolloutCount,
      seed,
    },
  };

  writeJsonFile(outputPath, output);
  console.log(`[oracle] wrote oracle data for ${enrichedSamples.length} samples to ${outputPath}`);
}

main().catch((error) => {
  console.error('[oracle] failed', error);
  process.exit(1);
});
