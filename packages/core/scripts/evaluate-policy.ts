import { buildBenchmarkSummary } from '../src/ai/benchmark-categories';
import { buildBenchmarkFixturesFromSamples } from '../src/ai/benchmark-fixtures';
import { DEFAULT_POLICY_ARTIFACT, scorePolicyFeatures } from '../src/ai/policy-artifact';
import type {
  PolicyArtifact,
  PolicyEvaluationReport,
  RolloutEvaluationCandidate,
  SelfPlayDatasetSample,
} from '../src/shared/types/ai';
import { parseArgs, readJsonFile, writeJsonFile } from './_common';

interface DatasetFile {
  version: string;
  generatedAt: string;
  samples: SelfPlayDatasetSample[];
}

function getArgString(value: string | number | boolean | undefined, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value : fallback;
}

function getBestOracleCandidate(sample: SelfPlayDatasetSample): RolloutEvaluationCandidate | undefined {
  if (!sample.oracle?.candidates?.length) {
    return undefined;
  }
  const candidates = [...sample.oracle.candidates];
  candidates.sort(
    (left, right) => right.predictedWinRate - left.predictedWinRate
      || right.predictedExpectedScore - left.predictedExpectedScore,
  );
  return candidates[0];
}

function pickLearnedTop(sample: SelfPlayDatasetSample, artifact: PolicyArtifact): string | undefined {
  let bestCode: string | undefined;
  let bestScore = -Infinity;

  for (const code of sample.legalDiscards) {
    const features = sample.policyFeaturesByAction?.[code];
    if (!features) continue;
    const scored = scorePolicyFeatures(features, artifact);
    const score = scored.predictedWinRate * 100 + scored.predictedExpectedScore;
    if (score > bestScore) {
      bestScore = score;
      bestCode = code;
    }
  }
  return bestCode || sample.legalDiscards[0];
}

function buildReport(samples: SelfPlayDatasetSample[], artifact: PolicyArtifact): PolicyEvaluationReport {
  let winRateDeltaAcc = 0;
  let expectedScoreDeltaAcc = 0;
  let counted = 0;

  const benchmarkEntries = samples.map((sample) => {
    const oracleTop = getBestOracleCandidate(sample);
    const learnedTop = pickLearnedTop(sample, artifact) || '';
    const heuristicTop = sample.heuristicTopOption || sample.legalDiscards[0];

    const oracleByCode = new Map<string, RolloutEvaluationCandidate>();
    for (const item of sample.oracle?.candidates || []) {
      const code = item.cards?.[0];
      if (code) {
        oracleByCode.set(code, item);
      }
    }

    const learnedOracle = oracleByCode.get(learnedTop);
    const heuristicOracle = oracleByCode.get(heuristicTop);
    if (learnedOracle && heuristicOracle) {
      winRateDeltaAcc += learnedOracle.predictedWinRate - heuristicOracle.predictedWinRate;
      expectedScoreDeltaAcc += learnedOracle.predictedExpectedScore - heuristicOracle.predictedExpectedScore;
      counted += 1;
    }

    return {
      sampleId: sample.sampleId,
      category: sample.turnCount <= 3 ? 'opening' : sample.turnCount >= 12 ? 'endgame' : 'midgame',
      learnedTop,
      heuristicTop,
      oracleTop: oracleTop?.cards?.[0],
    };
  });

  return {
    policyVersion: artifact.policyVersion,
    baselinePolicyVersion: 'heuristic-v1',
    totalSamples: samples.length,
    winRateDelta: counted > 0 ? Number((winRateDeltaAcc / counted).toFixed(6)) : 0,
    expectedScoreDelta: counted > 0 ? Number((expectedScoreDeltaAcc / counted).toFixed(6)) : 0,
    benchmarkSummary: buildBenchmarkSummary(benchmarkEntries),
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const datasetPath = getArgString(args.dataset, 'artifacts/selfplay-dataset.oracle.json');
  const artifactPath = typeof args.artifact === 'string' ? args.artifact : undefined;
  const outPath = getArgString(args.out, 'artifacts/policy-eval-report.json');
  const fixtureOutPath = getArgString(args.fixtureOut, 'artifacts/benchmark-fixtures.json');

  const dataset = readJsonFile<DatasetFile>(datasetPath);
  const artifact = artifactPath
    ? readJsonFile<PolicyArtifact>(artifactPath)
    : DEFAULT_POLICY_ARTIFACT;

  const report = buildReport(dataset.samples, artifact);
  const fixtures = buildBenchmarkFixturesFromSamples(dataset.samples, 20);

  writeJsonFile(outPath, report);
  writeJsonFile(fixtureOutPath, fixtures);

  console.log(`[eval] wrote report to ${outPath}`);
  console.log(`[eval] wrote benchmark fixtures to ${fixtureOutPath}`);
}

main().catch((error) => {
  console.error('[eval] failed', error);
  process.exit(1);
});
