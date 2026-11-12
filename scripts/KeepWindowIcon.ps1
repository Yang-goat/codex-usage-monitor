param(
    [Parameter(Mandatory=$true)][int]$ClientProcessId,
    [Parameter(Mandatory=$true)][string]$ClientPath,
    [Parameter(Mandatory=$true)][string]$IconPath,
    [string]$AppId
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'WindowIcon.ps1')
$mutex = New-Object Threading.Mutex($false, ('Local\CodexMeterWindowIcon-' + $ClientProcessId))
$owned = $false
$handles = @()
try {
    try { $owned = $mutex.WaitOne(0) } catch [Threading.AbandonedMutexException] { $owned = $true }
    if (-not $owned) { return }
    $client = Get-Process -Id $ClientProcessId -ErrorAction Stop
    if ($client.Path -ne $ClientPath -or $client.ProcessName -notin @('ChatGPT','Codex')) { throw 'Desktop client identity mismatch' }
    Add-Type -Path (Join-Path $PSScriptRoot 'WindowProperties.cs')
    $handles = @([MeterWindowProperties]::LoadIcon($IconPath,32),[MeterWindowProperties]::LoadIcon($IconPath,256))
    $command = '"' + (Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe') + '" -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + (Join-Path $PSScriptRoot 'Start.ps1') + '"'
    $properties = @{2=$command;3=($IconPath+',0');4='ChatGPT'}
    if ($AppId) { $properties[5]=$AppId }
    $runtime = Join-Path (Split-Path $PSScriptRoot -Parent) 'runtime'
    New-Item -ItemType Directory -Path $runtime -Force | Out-Null
    [pscustomobject]@{ClientPID=$ClientProcessId;HelperPID=$PID;Icon=$IconPath;AppId=$AppId} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $runtime ('window-icon-' + $ClientProcessId + '.json')) -Encoding UTF8
    # Keep HICONs alive for the desktop's entire lifetime, including close-to-tray and new windows.
    while (-not $client.HasExited) {
        Repair-MeterWindowIcons $ClientProcessId $handles $properties
        [void]$client.WaitForExit(2000)
    }
} finally {
    foreach ($handle in $handles) { [void][MeterWindowProperties]::DestroyIcon([IntPtr]$handle) }
    if ($owned) { $mutex.ReleaseMutex() }
    $mutex.Dispose()
}
