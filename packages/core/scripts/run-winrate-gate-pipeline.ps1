param(
  [int]$TargetSamples = 360,
  [int]$MaxBatches = 20,
  [int]$Seed = 20260328,
  [string]$CorpusFile = "benchmarks/discard-holdout-v2/corpus.json",
  [string]$BatchCommand = "ai:benchmark:build:resume:high",
  [int]$SelfPlayGames = 0,
  [int]$MaxSamples = 0,
  [int]$MaxTurnsPerGame = 0,
  [int]$RolloutCountPerAction = 0,
  [int]$MaxRolloutSteps = 0,
  [int]$MaxPerCategory = 0,
  [double]$ExpectedScoreWeight = 1,
  [string]$ArtifactFile = "artifacts/learned-policy/policy-artifact.json",
  [switch]$AllowPartial,
  [switch]$SkipTrain,
  [switch]$SkipEvaluate
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

foreach ($raw in $args) {
  if ($raw -match '^--([^=]+)=(.*)$') {
    $name = $Matches[1]
    $value = $Matches[2]
    switch ($name.ToLowerInvariant()) {
      "targetsamples" { $TargetSamples = [int]$value; continue }
      "maxbatches" { $MaxBatches = [int]$value; continue }
      "seed" { $Seed = [int]$value; continue }
      "corpusfile" { $CorpusFile = $value; continue }
      "batchcommand" { $BatchCommand = $value; continue }
      "selfplaygames" { $SelfPlayGames = [int]$value; continue }
      "maxsamples" { $MaxSamples = [int]$value; continue }
      "maxturnspergame" { $MaxTurnsPerGame = [int]$value; continue }
      "rolloutcountperaction" { $RolloutCountPerAction = [int]$value; continue }
      "maxrolloutsteps" { $MaxRolloutSteps = [int]$value; continue }
      "maxpercategory" { $MaxPerCategory = [int]$value; continue }
      "expectedscoreweight" { $ExpectedScoreWeight = [double]$value; continue }
      "artifactfile" { $ArtifactFile = $value; continue }
    }
  }
  if ($raw -match '^--([^=]+)$') {
    $name = $Matches[1]
    switch ($name.ToLowerInvariant()) {
      "skiptrain" { $SkipTrain = $true; continue }
      "skipevaluate" { $SkipEvaluate = $true; continue }
      "allowpartial" { $AllowPartial = $true; continue }
    }
  }
}

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$coreDir = Resolve-Path (Join-Path $scriptDir "..")
$repoDir = Resolve-Path (Join-Path $coreDir "..\..")

Set-Location $repoDir

function Invoke-Step {
  param(
    [string]$Label,
    [string[]]$Arguments
  )

  Write-Host "[pipeline] $Label"
  & pnpm @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "[pipeline] step failed: $Label (exit=$LASTEXITCODE)"
  }
}

function Get-HoldoutSampleCount {
  param(
    [string]$RelativeCorpusFile
  )

  $corpusPath = Join-Path $coreDir $RelativeCorpusFile
  if (!(Test-Path $corpusPath)) {
    return 0
  }

  try {
    $json = Get-Content $corpusPath -Raw -Encoding UTF8 | ConvertFrom-Json
  } catch {
    Write-Host "[pipeline] warning: failed to parse corpus json at $corpusPath, treating sample count as 0"
    return 0
  }
  if ($null -eq $json.samples) {
    return 0
  }
  return [int]$json.samples.Count
}

$currentSamples = Get-HoldoutSampleCount -RelativeCorpusFile $CorpusFile
Write-Host "[pipeline] current holdout samples: $currentSamples (target=$TargetSamples)"

$batch = 0
while ($currentSamples -lt $TargetSamples -and $batch -lt $MaxBatches) {
  $batch += 1
  $batchArgs = @(
    "--dir", "packages/core",
    "run", $BatchCommand,
    "--outputFile=$CorpusFile",
    "--seed=$Seed",
    "--targetSamples=$TargetSamples",
    "--maxBatches=1",
    "--resume=true"
  )
  if ($SelfPlayGames -gt 0) {
    $batchArgs += "--selfPlayGames=$SelfPlayGames"
  }
  if ($MaxSamples -gt 0) {
    $batchArgs += "--maxSamples=$MaxSamples"
  }
  if ($MaxTurnsPerGame -gt 0) {
    $batchArgs += "--maxTurnsPerGame=$MaxTurnsPerGame"
  }
  if ($RolloutCountPerAction -gt 0) {
    $batchArgs += "--rolloutCountPerAction=$RolloutCountPerAction"
  }
  if ($MaxRolloutSteps -gt 0) {
    $batchArgs += "--maxRolloutSteps=$MaxRolloutSteps"
  }
  if ($MaxPerCategory -gt 0) {
    $batchArgs += "--maxPerCategory=$MaxPerCategory"
  }
  if ($ExpectedScoreWeight -ge 0) {
    $batchArgs += "--expectedScoreWeight=$ExpectedScoreWeight"
  }
  Invoke-Step -Label "build holdout batch $batch/$MaxBatches" -Arguments $batchArgs
  $currentSamples = Get-HoldoutSampleCount -RelativeCorpusFile $CorpusFile
  Write-Host "[pipeline] holdout samples after batch ${batch}: $currentSamples"
}

if ($currentSamples -lt $TargetSamples) {
  if ($AllowPartial) {
    Write-Host "[pipeline] partial mode: holdout target not reached ($currentSamples < $TargetSamples), skip train/evaluate"
    Write-Host "[pipeline] completed successfully"
    return
  }
  throw "[pipeline] holdout target not reached: $currentSamples < $TargetSamples after $MaxBatches batches"
}

if (-not $SkipTrain) {
  Invoke-Step -Label "train gate" -Arguments @(
    "--dir", "packages/core",
    "run", "ai:train:gate",
    "--seed=$Seed",
    "--expectedScoreWeight=$ExpectedScoreWeight"
  )
}

if (-not $SkipEvaluate) {
  Invoke-Step -Label "evaluate gate" -Arguments @(
    "--dir", "packages/core",
    "run", "ai:evaluate:gate",
    "--artifactFile=$ArtifactFile",
    "--datasetFile=$CorpusFile",
    "--expectedScoreWeight=$ExpectedScoreWeight"
  )
}

Write-Host "[pipeline] completed successfully"
