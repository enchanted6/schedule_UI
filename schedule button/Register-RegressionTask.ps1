# Register a one-shot Windows Scheduled Task to run FIX Regression (cucumber-js).
#
# Example:
#   .\Register-RegressionTask.ps1 `
#     -RunAt "2026-08-20 15:30:00" `
#     -PayloadPath "C:\...\scheduled-regression\regression_123.json" `
#     -NodeExe "C:\...\electron.exe" `
#     -TestCasesDir "C:\...\Testing-UI\testCases" `
#     -CucumberBin "C:\...\node_modules\@cucumber\cucumber\bin\cucumber-js" `
#     -NodeModulesDir "C:\...\Testing-UI\node_modules" `
#     -Label "calculator.feature"

param(
    [Parameter(Mandatory = $true)]
    [string]$RunAt,

    [Parameter(Mandatory = $true)]
    [string]$PayloadPath,

    [Parameter(Mandatory = $true)]
    [string]$NodeExe,

    [Parameter(Mandatory = $true)]
    [string]$TestCasesDir,

    [Parameter(Mandatory = $true)]
    [string]$CucumberBin,

    [Parameter(Mandatory = $true)]
    [string]$NodeModulesDir,

    [Parameter(Mandatory = $false)]
    [string]$Label = ''
)

$ErrorActionPreference = 'Stop'

$runScriptPath = Join-Path $PSScriptRoot 'Run-RegressionTask.ps1'
if (-not (Test-Path -LiteralPath $runScriptPath)) {
    throw "Run-RegressionTask.ps1 not found next to this script: $runScriptPath"
}
if (-not (Test-Path -LiteralPath $PayloadPath)) {
    throw "Payload not found: $PayloadPath"
}

try {
    $when = [DateTime]::ParseExact($RunAt.Trim(), 'yyyy-MM-dd HH:mm:ss', $null)
}
catch {
    throw "RunAt must be yyyy-MM-dd HH:mm:ss (local time). Got: $RunAt"
}

if ($when -le [DateTime]::Now) {
    throw 'RunAt must be in the future.'
}

$stamp = $when.ToString('yyyyMMdd_HHmmss')
$safeLabel = if ($Label) {
    ($Label -replace '[^\w\-.]', '_').Trim('_')
}
else {
    'Regression'
}
if ($safeLabel.Length -gt 40) {
    $safeLabel = $safeLabel.Substring(0, 40)
}

$taskName = "TestPlatform_Regression_{0}_{1}" -f $stamp, $safeLabel
$taskName = ($taskName -replace '[^\w\-]', '_')

$psArgs = @(
    '-NoProfile'
    '-ExecutionPolicy', 'Bypass'
    '-File', $runScriptPath
    '-PayloadPath', $PayloadPath
    '-NodeExe', $NodeExe
    '-TestCasesDir', $TestCasesDir
    '-CucumberBin', $CucumberBin
    '-NodeModulesDir', $NodeModulesDir
)

$argString = ($psArgs | ForEach-Object {
        if ($_ -match '\s') { '"{0}"' -f ($_ -replace '"', '`"') } else { $_ }
    }) -join ' '

$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $argString
$trigger = New-ScheduledTaskTrigger -Once -At $when
$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable

$desc = if ($Label) { "FIX Regression: $Label @ $RunAt" } else { "FIX Regression @ $RunAt" }
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Description $desc -Force | Out-Null

$result = [pscustomobject]@{
    ok       = $true
    taskName = $taskName
    runAt    = $RunAt
    label    = $Label
    count    = 1
    ready    = $true
    payload  = $PayloadPath
}
$result | ConvertTo-Json -Depth 4 -Compress
