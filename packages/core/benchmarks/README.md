# Learned policy benchmark corpus

- Fixed holdout corpus file: `packages/core/benchmarks/discard-holdout-v2/corpus.json`
- Corpus source: deterministic self-play holdout, built outside the training output directory
- Default build command: `pnpm --dir packages/core run ai:benchmark:build`
- Default release gate command: `pnpm --dir packages/core run ai:evaluate:gate --artifactFile=<path-to-policy-artifact>`

## Contract

- Do not point release gate at `artifacts/learned-policy*/selfplay-dataset.json`
- `ai:evaluate:gate` must run against `discard-holdout-v2`
- Gate report writes `benchmarkVersion` so evaluation provenance is visible in the output JSON
- Training-set gate output is useful for debugging only; release decisions require the fixed holdout gate
- If the corpus needs refresh, regenerate it intentionally, review the diff, and update thresholds only with an explicit benchmark note

## Current gate baseline

- Current committed holdout corpus: `discard-holdout-v2`
- Target sample count: at least `300`
- Active overall gate: `winRateDelta >= 0.005`, `expectedScoreDelta >= -0.05`, `learnedOracleMatchRate >= 0.18`
- Stage guard: opening must not regress; midgame is allowed only a small temporary regression while samples remain sparse
- Action family guard: discard/response oracle match rate should not regress by more than the configured tolerance

## Recommended win-rate training command

```powershell
pnpm --dir packages/core exec tsx scripts/rollout-train-learned-policy.ts --samplePhase=all --selfPlayGames=160 --maxSamples=2200 --rolloutCountPerAction=16 --maxRolloutSteps=120 --oracleTopK=6 --earlyStopDelta=0.25 --oracleParallelism=6 --oracleChunkSize=16 --resume --outputDir=artifacts/learned-policy-winrate-v1
```

If the machine is under pressure, keep the same strategy settings and only lower `--oracleParallelism=4 --maxSamples=1400`.
