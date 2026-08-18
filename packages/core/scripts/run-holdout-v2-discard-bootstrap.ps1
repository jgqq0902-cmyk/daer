param(
  [int]$TargetSamples = 360,
  [int]$MaxRounds = 20,
  [int]$StartSeed = 20260340,
  [string]$CorpusFile = "benchmarks/discard-holdout-v2/corpus.json",
  [int]$SelfPlayGames = 6,
  [int]$MaxSamples = 60,
  [int]$RolloutCountPerAction = 4,
  [int]$MaxRolloutSteps = 80,
  [int]$OracleChunkSize = 2,
  [int]$MaxPerCategory = 100
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$coreDir = Resolve-Path (Join-Path $scriptDir "..")
$repoDir = Resolve-Path (Join-Path $coreDir "..\..")
Set-Location $repoDir

function Get-SampleCount {
  param([string]$RelativeCorpusFile)

  $corpusPath = Join-Path $coreDir $RelativeCorpusFile
  if (!(Test-Path $corpusPath)) {
    return 0
  }
  $json = Get-Content $corpusPath -Raw -Encoding UTF8 | ConvertFrom-Json
  if ($null -eq $json.samples) {
    return 0
  }
  return [int]$json.samples.Count
}

$current = Get-SampleCount -RelativeCorpusFile $CorpusFile
Write-Host "[holdout-v2-bootstrap] start samples=$current target=$TargetSamples"

for ($round = 0; $round -lt $MaxRounds; $round += 1) {
  if ($current -ge $TargetSamples) {
    break
  }

  $seed = $StartSeed + $round
  Write-Host "[holdout-v2-bootstrap] round=$($round + 1)/$MaxRounds seed=$seed"
  & pnpm --dir packages/core exec tsx scripts/rollout-build-benchmark-corpus.ts `
    --resume=true `
    --maxBatches=1 `
    --targetSamples=$TargetSamples `
    --selfPlayGames=$SelfPlayGames `
    --maxSamples=$MaxSamples `
    --batchSelfPlayGames=$SelfPlayGames `
    --batchMaxSamples=$MaxSamples `
    --samplePhase=discard `
    --rolloutCountPerAction=$RolloutCountPerAction `
    --maxRolloutSteps=$MaxRolloutSteps `
    --maxPerCategory=$MaxPerCategory `
    --expectedScoreWeight=1 `
    --maxNearTieRatio=1 `
    --oracleChunkSize=$OracleChunkSize `
    --maxResponseToDiscardRatio=0 `
    --minDiscardSamples=0 `
    --outputFile=$CorpusFile `
    --seed=$seed

  if ($LASTEXITCODE -ne 0) {
    throw "[holdout-v2-bootstrap] round failed seed=$seed exit=$LASTEXITCODE"
  }

  $current = Get-SampleCount -RelativeCorpusFile $CorpusFile
  Write-Host "[holdout-v2-bootstrap] round done samples=$current"
}

Write-Host "[holdout-v2-bootstrap] finished samples=$current"
