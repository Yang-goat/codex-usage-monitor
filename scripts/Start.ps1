param(
    [switch]$CheckOnly,
    [string]$AppPath,
    [string]$NodePath,
    [string]$CliPath,
    [ValidateRange(1024,65535)][int]$Port = 9339
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Common.ps1')
$record = Get-MonitorRecord
if ($record) {
    foreach ($name in @('AppPath','NodePath','CliPath','Port')) {
        if (-not $PSBoundParameters.ContainsKey($name) -and $null -ne $record.Settings.$name) {
            Set-Variable -Name $name -Value $record.Settings.$name
        }
    }
}
$client = Get-MonitorClient -AppPath $AppPath
$node = Get-MonitorNode -NodePath $NodePath
$cli = Get-MonitorCli -CliPath $CliPath -ClientExe $client.Exe
. (Join-Path $PSScriptRoot 'Lifecycle.ps1')
$context = [pscustomobject]@{Root=$script:MonitorRoot;Client=$client.Exe;Node=$node;Cli=$cli;Port=$Port;Key=(Get-MeterKey $script:MonitorRoot)}
if ($CheckOnly) {
    $endpoint=Get-MeterEndpoint $context
    [pscustomobject]@{Client=$client.Exe;Node=$node;Cli=$cli;Port=$Port;Running=(@(Get-MeterClientProcesses $context).Count -gt 0);DebugReady=($endpoint.State -eq 'ready');EndpointState=$endpoint.State;Helper=(Get-MeterHelper $context);Runtime=$script:MonitorRuntime} | ConvertTo-Json -Depth 4
    return
}
$previousRuntime=$env:CODEX_METER_RUNTIME
try {
    $env:CODEX_METER_RUNTIME=$script:MonitorRuntime
    Invoke-MeterLauncher -Root $script:MonitorRoot -Context $context
    # Cosmetic repair must never prevent the monitor from starting.
    try {
        . (Join-Path $PSScriptRoot 'WindowIcon.ps1')
        $endpoint = Get-MeterEndpoint $context
        Start-MeterWindowIcon $context $endpoint $client
    } catch { Write-Warning ('Taskbar icon: ' + $_.Exception.Message) }
} finally {
    $env:CODEX_METER_RUNTIME=$previousRuntime
}
