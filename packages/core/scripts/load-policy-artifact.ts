import { getActivePolicyArtifact, loadPolicyArtifact, scorePolicyFeatures } from '../src/ai/policy-artifact';
import type { PolicyArtifact } from '../src/shared/types/ai';
import { parseArgs, readJsonFile } from './_common';

function getArgString(value: string | number | boolean | undefined, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value : fallback;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const artifactPath = getArgString(args.artifact, 'artifacts/policy-artifact.learned-v1.json');
  const artifact = readJsonFile<PolicyArtifact>(artifactPath);
  loadPolicyArtifact(artifact);

  const sanity = scorePolicyFeatures({
    heuristic_win_rate: 0.5,
    heuristic_expected_score: 8,
    heuristic_priority: 100,
    wait_count: 2,
    remaining_wait_count: 6,
    max_round_score: 10,
    danger_score: 20,
    speed_score: 3,
    ukeire_score: 4,
    score_bonus: 2,
    dead_tile_flag: 0,
    isolated_flag: 1,
    nearly_dead_flag: 0,
    stable_structure_loss: 0,
    flexibility_score: 3,
    response_value: 1,
    gui_value: 0,
  });

  const active = getActivePolicyArtifact();
  console.log(`[artifact] loaded ${active.policyVersion} from ${artifactPath}`);
  console.log(`[artifact] sanity predictedWinRate=${sanity.predictedWinRate.toFixed(4)} predictedExpectedScore=${sanity.predictedExpectedScore.toFixed(4)}`);
}

main().catch((error) => {
  console.error('[artifact] failed', error);
  process.exit(1);
});
