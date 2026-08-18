import {
  DEFAULT_POLICY_ARTIFACT,
  loadPolicyArtifact,
} from '../src/ai/policy-artifact';
import type { PolicyArtifact } from '../src/shared/types/ai';
import { parseArgs, readJsonFile, writeJsonFile } from './_common';

function getArgString(value: string | number | boolean | undefined, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value : fallback;
}

function buildArtifactFromBase(base: PolicyArtifact, policyVersion: string): PolicyArtifact {
  return {
    ...base,
    policyVersion,
    generatedAt: new Date().toISOString(),
    trainingMeta: {
      ...base.trainingMeta,
      iteration: (base.trainingMeta?.iteration || 0) + 1,
    },
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const out = getArgString(args.out, 'artifacts/policy-artifact.learned-v1.json');
  const from = typeof args.from === 'string' ? args.from : undefined;
  const policyVersion = getArgString(args.version, 'learned-v1-scaffold');

  const baseArtifact = from
    ? readJsonFile<PolicyArtifact>(from)
    : DEFAULT_POLICY_ARTIFACT;

  const artifact = buildArtifactFromBase(baseArtifact, policyVersion);
  loadPolicyArtifact(artifact);
  writeJsonFile(out, artifact);

  console.log(`[artifact] exported ${artifact.policyVersion} to ${out}`);
}

main().catch((error) => {
  console.error('[artifact] failed', error);
  process.exit(1);
});
