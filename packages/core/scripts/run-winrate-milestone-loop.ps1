param(
  [int]$Iterations = 3,
  [int]$ConsecutivePassTarget = 2,
  [int]$BaseSeed = 20260331,
  [string]$CorpusFile = "benchmarks/discard-holdout-v2/corpus.json",
  [string]$OutputRoot = "artifacts/winrate-v2-loop"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$coreDir = Resolve-Path (Join-Path $scriptDir "..")
$repoDir = Resolve-Path (Join-Path $coreDir "..\..")
Set-Location $repoDir

function Invoke-Step {
  param(
    [string]$Label,
    [string[]]$Arguments
  )

  Write-Host "[milestone-loop] $Label"
  & pnpm @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "[milestone-loop] step failed: $Label (exit=$LASTEXITCODE)"
  }
}

function Read-Json {
  param([string]$Path)
  Get-Content $Path -Raw -Encoding UTF8 | ConvertFrom-Json
}

$consecutivePass = 0
$passIterations = @()

for ($i = 1; $i -le $Iterations; $i += 1) {
  $seed = $BaseSeed + $i - 1
  $iterDir = "$OutputRoot/iter-$i"
  $artifactFile = "$iterDir/policy-artifact.json"
  $trainReportFile = "$iterDir/policy-evaluation.train.json"
  $holdoutReportFile = "$iterDir/policy-evaluation.holdout-milestone.json"

  Invoke-Step -Label "train iteration $i seed=$seed" -Arguments @(
    "--dir", "packages/core",
    "exec", "tsx", "scripts/rollout-train-learned-policy.ts",
    "--seed=$seed",
    "--expectedScoreWeight=1",
    "--outputDir=$iterDir",
    "--reportFile=$trainReportFile"
  )

  Invoke-Step -Label "evaluate milestone iteration $i" -Arguments @(
    "--dir", "packages/core",
    "exec", "tsx", "scripts/rollout-evaluate-policy.ts",
    "--datasetFile=$CorpusFile",
    "--artifactFile=$artifactFile",
    "--outputFile=$holdoutReportFile",
    "--expectedScoreWeight=1",
    "--minSamples=300",
    "--minWinRateDelta=0.0001",
    "--minExpectedScoreDelta=-0.05",
    "--minLearnedOracleMatchRate=0.18",
    "--minCategoryWinRateDelta=midgame:0.0001",
    "--minActionFamilyWinRateDelta=discard:0.0001",
    "--minActionFamilyOracleMatchRateDelta=discard:-0.03,response:-0.03",
    "--requiredBenchmarkVersion=discard-holdout-v2"
  )

  $reportPath = Join-Path $coreDir $holdoutReportFile
  $report = Read-Json -Path $reportPath
  $gatePassed = [bool]$report.gate.passed
  if ($gatePassed) {
    $consecutivePass += 1
    $passIterations += $i
  } else {
    $consecutivePass = 0
  }

  Write-Host "[milestone-loop] iteration=$i gate=$gatePassed winRateDelta=$($report.winRateDelta) expectedScoreDelta=$($report.expectedScoreDelta) consecutivePass=$consecutivePass"
  if ($consecutivePass -ge $ConsecutivePassTarget) {
    Write-Host "[milestone-loop] reached consecutive pass target ($ConsecutivePassTarget) at iteration $i"
    break
  }
}

Write-Host "[milestone-loop] done passIterations=$($passIterations -join ',')"
