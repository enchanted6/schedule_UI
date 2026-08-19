# Run cucumber-js headlessly for a Windows Scheduled Task.
# Payload JSON shape (written by Electron main):
#   { "params": { "_mode", "featureFile?", "tags?", "scenarioNames"? }, "label"?: string }

param(
    [Parameter(Mandatory = $true)]
    [string]$PayloadPath,

    [Parameter(Mandatory = $true)]
    [string]$NodeExe,

    [Parameter(Mandatory = $true)]
    [string]$TestCasesDir,

    [Parameter(Mandatory = $true)]
    [string]$CucumberBin,

    [Parameter(Mandatory = $true)]
    [string]$NodeModulesDir
)

$ErrorActionPreference = 'Stop'

function Escape-RegexMeta([string]$Text) {
    return [regex]::Escape($Text)
}

if (-not (Test-Path -LiteralPath $PayloadPath)) {
    throw "Payload not found: $PayloadPath"
}
if (-not (Test-Path -LiteralPath $NodeExe)) {
    throw "NodeExe not found: $NodeExe"
}
if (-not (Test-Path -LiteralPath $TestCasesDir)) {
    throw "TestCasesDir not found: $TestCasesDir"
}
if (-not (Test-Path -LiteralPath $CucumberBin)) {
    throw "CucumberBin not found: $CucumberBin"
}

$raw = Get-Content -LiteralPath $PayloadPath -Raw -Encoding UTF8
$payload = $raw | ConvertFrom-Json
$params = $payload.params
if (-not $params) {
    throw 'Payload missing "params".'
}

$cucumberArgs = @('--format', 'message')

if ($params.featureFile) {
    $featurePath = ($params.featureFile -replace '\\', '/')
    $cucumberArgs += ("features/{0}" -f $featurePath)
}
else {
    $cucumberArgs += 'features/'
}

if ($params.tags) {
    $cucumberArgs += @('--tags', [string]$params.tags)
}

if ($params.scenarioNames -and @($params.scenarioNames).Count -gt 0) {
    $escaped = @($params.scenarioNames | ForEach-Object { Escape-RegexMeta ([string]$_) })
    $pattern = '^(' + ($escaped -join '|') + ')$'
    $cucumberArgs += @('--name', $pattern)
}

$logDir = Split-Path -Parent $PayloadPath
$logFile = Join-Path $logDir ("run-{0}.log" -f ([DateTime]::Now.ToString('yyyyMMdd_HHmmss')))

$env:ELECTRON_RUN_AS_NODE = '1'
$env:NODE_PATH = $NodeModulesDir

@(
    "[$([DateTime]::Now.ToString('yyyy-MM-dd HH:mm:ss'))] Starting regression"
    "NodeExe: $NodeExe"
    "CucumberBin: $CucumberBin"
    "TestCasesDir: $TestCasesDir"
    "Payload: $PayloadPath"
    "Args: $($cucumberArgs -join ' ')"
) | Out-File -LiteralPath $logFile -Encoding utf8

Push-Location $TestCasesDir
try {
    & $NodeExe $CucumberBin @cucumberArgs *>&1 | Tee-Object -FilePath $logFile -Append
    $exitCode = $LASTEXITCODE
}
finally {
    Pop-Location
}

"[$([DateTime]::Now.ToString('yyyy-MM-dd HH:mm:ss'))] Exit code: $exitCode" | Out-File -LiteralPath $logFile -Append -Encoding utf8

if ($exitCode -ne 0 -and $exitCode -ne 1) {
    exit $exitCode
}
exit 0
