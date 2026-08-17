param(
    [string]$BundleDirectory = (Join-Path $PSScriptRoot '..\build\windows\bridge'),
    [int]$Port = 49312
)

$ErrorActionPreference = 'Stop'
$bundlePath = (Resolve-Path $BundleDirectory).Path
$nodePath = Join-Path $bundlePath 'runtime\node.exe'
$entryPath = Join-Path $bundlePath 'bridge-server.mjs'
$smokeRoot = Join-Path ([IO.Path]::GetTempPath()) 'daer-bridge-smoke'
$statePath = Join-Path $smokeRoot 'state.json'
$token = 'b' * 64
$wrongToken = 'c' * 64
$sessionId = 'bundle-smoke-20260818'

if (-not (Test-Path -LiteralPath $nodePath) -or -not (Test-Path -LiteralPath $entryPath)) {
    throw "Bridge bundle is incomplete: $bundlePath"
}

New-Item -ItemType Directory -Path $smokeRoot -Force | Out-Null

$startInfo = [Diagnostics.ProcessStartInfo]::new()
$startInfo.FileName = $nodePath
$startInfo.WorkingDirectory = $bundlePath
$startInfo.UseShellExecute = $false
$startInfo.CreateNoWindow = $true
    $startInfo.ArgumentList.Add($entryPath)
$startInfo.Environment['DAER_GODOT_AI_PORT'] = "$Port"
$startInfo.Environment['DAER_GODOT_SESSION_ID'] = $sessionId
$startInfo.Environment['DAER_BRIDGE_TOKEN'] = $token
$startInfo.Environment['DAER_GODOT_STATE_FILE'] = $statePath

$process = [Diagnostics.Process]::new()
$process.StartInfo = $startInfo
$process.Start() | Out-Null

try {
    $baseUrl = "http://127.0.0.1:$Port"

    function Send-BridgeRequest {
        param(
            [string]$Method,
            [string]$Path,
            [string]$RequestBody = $null,
            [string]$BearerToken = $null
        )

        $headers = @{}
        if ($null -ne $BearerToken) {
            $headers.Authorization = "Bearer $BearerToken"
        }
        $requestParameters = @{
            Method = $Method
            Uri = "$baseUrl$Path"
            Headers = $headers
            TimeoutSec = 5
            SkipHttpErrorCheck = $true
        }
        if ($null -ne $RequestBody) {
            $requestParameters.ContentType = 'application/json'
            $requestParameters.Body = $RequestBody
        }
        $response = Invoke-WebRequest @requestParameters
        [pscustomobject]@{
            status = [int]$response.StatusCode
            body = $response.Content
            hasWildcardCors = $response.Headers.ContainsKey('Access-Control-Allow-Origin')
        }
    }

    $health = $null
    for ($attempt = 0; $attempt -lt 20; $attempt++) {
        try {
            $health = Send-BridgeRequest -Method 'GET' -Path '/health' -BearerToken $token
            if ($health.status -eq 200) { break }
        } catch {
            Start-Sleep -Milliseconds 100
        }
    }
    if ($null -eq $health -or $health.status -ne 200) {
        throw 'Bridge did not become ready.'
    }

    $newGame = Send-BridgeRequest -Method 'POST' -Path '/api/game/new' -BearerToken $token -RequestBody '{"playerCount":4,"bottomCardCount":2,"seed":20260818}'
    $withoutToken = Send-BridgeRequest -Method 'GET' -Path '/health'
    $wrongTokenResult = Send-BridgeRequest -Method 'GET' -Path '/health' -BearerToken $wrongToken
    $options = Send-BridgeRequest -Method 'OPTIONS' -Path '/api/game/state' -BearerToken $token
    $largeBody = '{"padding":"' + ('x' * 70000) + '"}'
    $tooLarge = Send-BridgeRequest -Method 'POST' -Path '/api/game/new' -BearerToken $token -RequestBody $largeBody

    $healthJson = $health.body | ConvertFrom-Json
    $newGameJson = $newGame.body | ConvertFrom-Json
    $checks = [pscustomobject]@{
        protocol = $healthJson.protocolVersion
        runtime = $healthJson.runtimeVersion
        players = @($newGameJson.state.players).Count
        ruleVersion = $newGameJson.state.ruleVersion
        unauthorized = $withoutToken.status
        wrongToken = $wrongTokenResult.status
        options = $options.status
        oversized = $tooLarge.status
        wildcardCors = ($health.hasWildcardCors -or $newGame.hasWildcardCors)
    }

    if ($checks.protocol -ne 'daer-godot-v2' -or
        $checks.runtime -ne 'daer-bridge-session-v6' -or
        $checks.players -ne 3 -or
        $checks.ruleVersion -ne 'luzhou-daer-rules-v2.4' -or
        $checks.unauthorized -ne 401 -or
        $checks.wrongToken -ne 401 -or
        $checks.options -ne 404 -or
        $checks.oversized -ne 413 -or
        $checks.wildcardCors) {
        throw "Bridge smoke checks failed: $($checks | ConvertTo-Json -Compress)"
    }

    $checks | ConvertTo-Json -Compress
}
finally {
    if ($process -and -not $process.HasExited) {
        $process.Kill($true)
        $process.WaitForExit()
    }
    $process.Dispose()
    if (Test-Path -LiteralPath $statePath) { Remove-Item -LiteralPath $statePath -Force }
}
