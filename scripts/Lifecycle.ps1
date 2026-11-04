# Windows PowerShell 5.1-compatible lifecycle helpers. No actions on dot-source.
function Get-MeterKey($Root) {
    $hash = [Security.Cryptography.SHA256]::Create()
    try { return ([BitConverter]::ToString($hash.ComputeHash([Text.Encoding]::UTF8.GetBytes([IO.Path]::GetFullPath($Root).TrimEnd('\').ToUpperInvariant())))).Replace('-','').ToLowerInvariant().Substring(0,24) }
    finally { $hash.Dispose() }
}

function Get-MeterClientProcesses($Context) {
    return @(Get-Process -Name ChatGPT,Codex -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $Context.Client })
}

function Test-MeterPortFree($Port) {
    $listener = New-Object Net.Sockets.TcpListener([Net.IPAddress]::Loopback, $Port)
    try { $listener.Server.ExclusiveAddressUse = $true; $listener.Start(); return $true }
    catch [Net.Sockets.SocketException] { return $false }
    finally { $listener.Stop() }
}

function Get-MeterEndpoint($Context) {
    # Fail closed if TCP ownership cannot be inspected. Validate before HTTP.
    $listeners = @(Get-NetTCPConnection -State Listen -ErrorAction Stop | Where-Object { $_.LocalPort -eq $Context.Port })
    if ($listeners.Count -eq 0) {
        if (Test-MeterPortFree $Context.Port) { return [pscustomobject]@{ State='free'; Owner=$null } }
        return [pscustomobject]@{ State='releasing'; Owner=$null }
    }
    $ownerId = $null
    foreach ($listener in $listeners) {
        if ($listener.LocalAddress -notin @('127.0.0.1','::1')) { throw '检测到非回环调试端口，停止连接。' }
        $owner = Get-Process -Id $listener.OwningProcess -ErrorAction SilentlyContinue
        if (-not $owner) { return [pscustomobject]@{ State='releasing'; Owner=$null } }
        if ($owner.Path -ne $Context.Client) { throw "端口 $($Context.Port) 属于其他程序，未连接或关闭该程序。" }
        $ownerId = $owner.Id
    }
    try {
        $version = Invoke-RestMethod -Uri "http://127.0.0.1:$($Context.Port)/json/version" -TimeoutSec 1
        if ($version.Browser -match 'Chrome|Codex|ChatGPT' -and $version.webSocketDebuggerUrl -match '^ws://(127\.0\.0\.1|localhost):') {
            return [pscustomobject]@{ State='ready'; Owner=$ownerId }
        }
    } catch {}
    return [pscustomobject]@{ State='starting'; Owner=$ownerId }
}

function Get-MeterHelper($Context) {
    $pipe = New-Object IO.Pipes.NamedPipeClientStream('.', ('codex-composer-meter-' + $Context.Key), [IO.Pipes.PipeDirection]::In, [IO.Pipes.PipeOptions]::Asynchronous)
    try {
        $pipe.Connect(300)
        $buffer = New-Object byte[] 4096
        $text = ''; $watch = [Diagnostics.Stopwatch]::StartNew()
        while ($text.IndexOf("`n") -lt 0 -and $text.Length -lt 4096) {
            $remaining = [Math]::Max(1, 1000 - [int]$watch.ElapsedMilliseconds)
            $read = $pipe.ReadAsync($buffer,0,$buffer.Length)
            if (-not $read.Wait($remaining) -or $read.Result -eq 0) { return $null }
            $text += [Text.Encoding]::UTF8.GetString($buffer,0,$read.Result)
            if ($watch.ElapsedMilliseconds -ge 1000) { return $null }
        }
        $info = $text.Split("`n")[0] | ConvertFrom-Json
        if ($info.protocol -eq 'codex-meter/1') { return $info }
    } catch {}
    finally { $pipe.Dispose() }
    return $null
}

function Wait-MeterEndpoint($Context, $TimeoutMilliseconds = 20000) {
    $watch = [Diagnostics.Stopwatch]::StartNew()
    $launched = $false
    do {
        $endpoint = Get-MeterEndpoint $Context
        if ($endpoint.State -eq 'ready') { return $endpoint }
        $running = @(Get-MeterClientProcesses $Context).Count -gt 0
        if (-not $launched -and -not $running -and $endpoint.State -eq 'free') {
            Start-Process -FilePath $Context.Client -ArgumentList @("--remote-debugging-port=$($Context.Port)",'--remote-debugging-address=127.0.0.1') -WindowStyle Normal | Out-Null
            $launched = $true
        }
        Start-Sleep -Milliseconds 500
    } while ($watch.ElapsedMilliseconds -lt $TimeoutMilliseconds)
    if ($endpoint.State -eq 'releasing') { throw '指定端口仍在释放或被系统保留，请稍后重试；启动器没有切换端口。' }
    if (-not $launched -and $running) { throw 'Codex 已运行，但 指定调试端口未就绪。请正常退出全部 Codex 实例后从桌面图标重开；当前任务未被关闭。' }
    throw '等待 Codex 调试端口就绪超时，请稍后重试。'
}

function Start-MeterHelper($Context, $Owner) {
    $previous = @{}
    foreach ($name in @('CODEX_METER_PORT','CODEX_METER_CLI','CODEX_METER_CLIENT_PID')) { $previous[$name] = [Environment]::GetEnvironmentVariable($name,'Process') }
    try {
        $env:CODEX_METER_PORT = [string]$Context.Port
        $env:CODEX_METER_CLI = $Context.Cli
        $env:CODEX_METER_CLIENT_PID = [string]$Owner
        return Start-Process -FilePath $Context.Node -ArgumentList @('"'+(Join-Path $Context.Root 'src\main.mjs')+'"') -WorkingDirectory $Context.Root -WindowStyle Hidden -PassThru
    } finally {
        foreach ($name in $previous.Keys) { [Environment]::SetEnvironmentVariable($name,$previous[$name],'Process') }
    }
}

function Ensure-MeterHelper($Context, $Endpoint, $TimeoutMilliseconds = 20000) {
    $watch = [Diagnostics.Stopwatch]::StartNew()
    $started = $false; $child = $null
    do {
        $helper = Get-MeterHelper $Context
        if ($helper -and $helper.state -eq 'running') {
            if ($helper.debugPort -ne $Context.Port) { throw '已有状态条连接其他端口，请正常退出 Codex 后重开。' }
            return
        }
        if (-not $helper -and -not $started) {
            $child = Start-MeterHelper $Context $Endpoint.Owner
            $started = $true
        }
        if ($started -and $child.HasExited -and -not $helper) { throw '状态条辅助进程未能启动；请检查 runtime/status.json，旧辅助进程可能仍在退出。' }
        Start-Sleep -Milliseconds 300
    } while ($watch.ElapsedMilliseconds -lt $TimeoutMilliseconds)
    throw '等待状态条辅助进程就绪超时；没有强制关闭任何既有进程。'
}

function Invoke-MeterLauncher($Root, [switch]$CheckOnly, $Context) {
    if (-not $Context) {
    $node = (Get-Command node.exe -ErrorAction Stop).Source
    $cliCommand = Get-Command codex.exe -ErrorAction SilentlyContinue | Select-Object -First 1
    $cli = if ($cliCommand) { $cliCommand.Source } else { $null }
    $package = Get-AppxPackage -Name OpenAI.Codex | Sort-Object Version -Descending | Select-Object -First 1
    if (-not $package) { throw '未找到 OpenAI.Codex 桌面端安装。' }
    $client = Join-Path $package.InstallLocation 'app\ChatGPT.exe'
    if (-not (Test-Path -LiteralPath $client)) { $client = Join-Path $package.InstallLocation 'app\Codex.exe' }
    if (-not (Test-Path -LiteralPath $client)) { throw '未找到桌面客户端可执行文件。' }
    $context = [pscustomobject]@{ Root=$Root; Client=$client; Node=$node; Cli=$cli; Port=9339; Key=(Get-MeterKey $Root) }
    }
    if ($CheckOnly) {
        $endpoint = Get-MeterEndpoint $context
        [pscustomobject]@{ Client=$context.Client; Node=$context.Node; Cli=$context.Cli; Running=(@(Get-MeterClientProcesses $context).Count -gt 0); DebugReady=($endpoint.State -eq 'ready'); Port=$context.Port; EndpointState=$endpoint.State; Helper=(Get-MeterHelper $context) } | ConvertTo-Json -Depth 4
        return
    }
    $mutex = New-Object Threading.Mutex($false, ('Local\CodexComposerMeterLauncher-' + $context.Key))
    $owned = $false
    try {
        try { $owned = $mutex.WaitOne(0) } catch [Threading.AbandonedMutexException] { $owned = $true }
        if (-not $owned) { Write-Output 'Codex 状态条正在启动，本次重复启动已忽略。'; return }
        $endpoint = Wait-MeterEndpoint $context
        Ensure-MeterHelper $context $endpoint
    } finally {
        if ($owned) { $mutex.ReleaseMutex() }
        $mutex.Dispose()
    }
}
