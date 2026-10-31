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
$listeners = @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
foreach ($listener in $listeners) {
    $owner = Get-Process -Id $listener.OwningProcess -ErrorAction Stop
    if ($owner.Path -ne $client.Exe) { throw "端口 $Port 属于其他程序，未连接。请用 Install.ps1 -Port 设置空闲端口。" }
    if ($listener.LocalAddress -notin @('127.0.0.1','::1')) { throw '调试端口不是本机回环监听，停止连接。' }
}
$ready = $false
if ($listeners.Count -gt 0) {
    try {
        $version = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/json/version" -TimeoutSec 2
        $ready = $version.Browser -match 'Chrome|Codex|ChatGPT'
    } catch {}
}
$running = @(Get-Process -Name ChatGPT,Codex -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $client.Exe }).Count -gt 0
if ($CheckOnly) {
    [pscustomobject]@{Client=$client.Exe;Node=$node;Cli=$cli;Port=$Port;Running=$running;DebugReady=$ready;Runtime=$script:MonitorRuntime} | ConvertTo-Json
    return
}
if ($running -and -not $ready) {
    Add-Type -AssemblyName System.Windows.Forms
    [System.Windows.Forms.MessageBox]::Show('请先正常退出所有 Codex 窗口（包括托盘实例），再从已接入的桌面图标启动。监控不会强制关闭你的客户端或任务。','Codex 用量监控','OK','Information') | Out-Null
    return
}
if (-not $ready) {
    if ($listeners.Count -gt 0) { throw '已有监听端口无法识别为客户端调试服务，停止启动。' }
    Start-Process -FilePath $client.Exe -ArgumentList @("--remote-debugging-port=$Port",'--remote-debugging-address=127.0.0.1') -WindowStyle Normal
}
$env:CODEX_METER_PORT = [string]$Port
$env:CODEX_METER_CLI = $cli
$env:CODEX_METER_RUNTIME = $script:MonitorRuntime
Start-Process -FilePath $node -ArgumentList @('"' + (Join-Path $script:MonitorRoot 'src\main.mjs') + '"') -WorkingDirectory $script:MonitorRoot -WindowStyle Hidden
