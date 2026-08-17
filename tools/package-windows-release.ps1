[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$CoreWorkspace,
    [string]$GodotExecutable = "K:\godot\Godot_v4.7.1-stable_win64_console.exe",
    [string]$NodeRuntime = "C:\Program Files\nodejs\node.exe",
    [string]$OutputDirectory = (Join-Path $PSScriptRoot "..\build\windows"),
    [switch]$ExportDebug,
    [switch]$SkipGodotExport
)

$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$coreRoot = (Resolve-Path (Join-Path $CoreWorkspace 'packages\core')).Path
$nodeRuntimePath = (Resolve-Path $NodeRuntime).Path
$godotPath = (Resolve-Path $GodotExecutable).Path
$outputPath = [IO.Path]::GetFullPath($OutputDirectory)
$bridgePath = Join-Path $outputPath 'bridge'
$releaseBinary = Join-Path $outputPath 'DaerTraining.exe'
$tsxLink = Get-Item -LiteralPath (Join-Path $coreRoot 'node_modules\tsx')
$tsxPackagePath = [string]$tsxLink.Target
if ([string]::IsNullOrWhiteSpace($tsxPackagePath)) {
    throw 'Cannot resolve the local tsx runtime used to build the Bridge.'
}
$tsxStorePath = Split-Path $tsxPackagePath -Parent
$esbuildScript = (Resolve-Path (Join-Path $tsxStorePath 'esbuild\bin\esbuild')).Path
$bridgeEntry = Join-Path $bridgePath 'bridge-server.mjs'
$bridgeVersionFile = Join-Path $bridgePath 'runtime-version.txt'
$bridgeRuntimeVersion = 'daer-bridge-session-v5'

if (Test-Path $outputPath) {
    Remove-Item -LiteralPath $outputPath -Recurse -Force
}
New-Item -ItemType Directory -Path $outputPath -Force | Out-Null

if (-not $SkipGodotExport) {
    $exportArgs = @('--headless', '--path', $projectRoot, '--export-release', 'Windows Desktop', $releaseBinary)
    if ($ExportDebug) {
        $exportArgs = @('--headless', '--path', $projectRoot, '--export-debug', 'Windows Desktop', $releaseBinary)
    }
    & $godotPath @exportArgs
    if ($LASTEXITCODE -ne 0) {
        throw "Godot Windows export failed with exit code $LASTEXITCODE."
    }
}

New-Item -ItemType Directory -Path $bridgePath -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $projectRoot 'bridge\daer-ai-server.cmd') -Destination $bridgePath
New-Item -ItemType Directory -Path (Join-Path $bridgePath 'runtime') -Force | Out-Null
Copy-Item -LiteralPath $nodeRuntimePath -Destination (Join-Path $bridgePath 'runtime\node.exe')

Push-Location $coreRoot
try {
    # Bundle the Bridge and rule core into one ESM file. The release package
    # therefore needs no pnpm workspace, tsx loader, or node_modules tree.
    & $nodeRuntimePath $esbuildScript 'scripts\godot-ai-server.ts' '--bundle' '--platform=node' '--format=esm' '--target=node20' ("--outfile={0}" -f $bridgeEntry)
    if ($LASTEXITCODE -ne 0) {
        throw "Bridge bundle build failed with exit code $LASTEXITCODE."
    }
}
finally {
    Pop-Location
}

if (-not (Test-Path $bridgeEntry)) {
    throw 'Bridge bundle does not contain bridge-server.mjs.'
}
[IO.File]::WriteAllText(
    $bridgeVersionFile,
    $bridgeRuntimeVersion + [Environment]::NewLine,
    [Text.UTF8Encoding]::new($false)
)

if ($SkipGodotExport) {
    Write-Host "Bridge sidecar created without Godot export: $bridgePath"
}
else {
    Write-Host "Windows release created: $releaseBinary"
}
Write-Host "Bundled Bridge: $bridgePath"
