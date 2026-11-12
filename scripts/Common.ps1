$script:MonitorRoot = Split-Path $PSScriptRoot -Parent
$script:MonitorRuntime = Join-Path $script:MonitorRoot 'runtime'
$script:MonitorRecord = Join-Path $script:MonitorRuntime 'installation.json'

function Write-MonitorRecord {
    param($Record)
    New-Item -ItemType Directory -Path $script:MonitorRuntime -Force | Out-Null
    $Record | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $script:MonitorRecord -Encoding UTF8
}

function Get-MonitorRecord {
    if (Test-Path -LiteralPath $script:MonitorRecord) {
        return Get-Content -LiteralPath $script:MonitorRecord -Encoding UTF8 -Raw | ConvertFrom-Json
    }
    return $null
}

function Get-MonitorClient {
    param([string]$AppPath)
    $package = Get-AppxPackage -Name OpenAI.Codex -ErrorAction SilentlyContinue | Sort-Object Version -Descending | Select-Object -First 1
    if ($AppPath) {
        $exe = [IO.Path]::GetFullPath($AppPath)
        if (-not (Test-Path -LiteralPath $exe -PathType Leaf)) { throw "客户端文件不存在：$exe" }
        if ([IO.Path]::GetFileName($exe) -notin @('ChatGPT.exe', 'Codex.exe')) { throw '-AppPath 应指向 Codex 桌面客户端的 ChatGPT.exe 或 Codex.exe，不能填写 CLI codex.exe。' }
        if (-not (Test-Path -LiteralPath (Join-Path (Split-Path $exe -Parent) 'resources\app.asar') -PathType Leaf)) { throw '-AppPath 旁未发现桌面客户端资源，可能误选了 CLI。' }
    } elseif ($package) {
        $exe = Join-Path $package.InstallLocation 'app\ChatGPT.exe'
        if (-not (Test-Path -LiteralPath $exe -PathType Leaf)) { $exe = Join-Path $package.InstallLocation 'app\Codex.exe' }
        if (-not (Test-Path -LiteralPath $exe -PathType Leaf)) { throw '已发现安装包，但无法识别客户端程序，请使用 -AppPath 指定。' }
    } else {
        throw '没有找到 OpenAI.Codex 商店安装。请先安装 Codex，或用 -AppPath 指定桌面客户端。'
    }
    $icon = Join-Path (Split-Path $exe -Parent) 'resources\icon-chatgpt.ico'
    if (-not (Test-Path -LiteralPath $icon)) { $icon = $exe }
    return [pscustomobject]@{ Exe=$exe; Icon=$icon; PackageFamily=if($package -and $exe.StartsWith($package.InstallLocation + '\',[StringComparison]::OrdinalIgnoreCase)){$package.PackageFamilyName}else{$null} }
}

function Get-MonitorNode {
    param([string]$NodePath)
    if ($NodePath) {
        if (-not (Test-Path -LiteralPath $NodePath -PathType Leaf)) { throw "Node.js 不存在：$NodePath" }
        $node = [IO.Path]::GetFullPath($NodePath)
    } else {
        $command = Get-Command node.exe -ErrorAction SilentlyContinue | Select-Object -First 1
        if (-not $command) { throw '需要 Node.js 22 或更新版本。请安装 Node.js LTS 后重新打开 PowerShell。' }
        $node = $command.Source
    }
    $version = (& $node --version).Trim()
    if ($LASTEXITCODE -ne 0 -or $version -notmatch '^v(\d+)\.' -or [int]$Matches[1] -lt 22) { throw '需要可正常运行的 Node.js 22 或更新版本。' }
    return $node
}

function Get-MonitorCli {
    param([string]$CliPath, [string]$ClientExe)
    if ($CliPath) {
        if (-not (Test-Path -LiteralPath $CliPath -PathType Leaf)) { throw "CLI 文件不存在：$CliPath" }
        return [IO.Path]::GetFullPath($CliPath)
    }
    $command = Get-Command codex.exe -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($command) { return $command.Source }
    $bundled = Join-Path (Split-Path $ClientExe -Parent) 'resources\codex.exe'
    if (Test-Path -LiteralPath $bundled -PathType Leaf) { return $bundled }
    return $null
}

function Get-MonitorStableIcon {
    param($Client)
    if ([IO.Path]::GetExtension($Client.Icon) -ne '.ico') { return $Client.Icon }
    $directory = Join-Path $script:MonitorRuntime 'icons'
    New-Item -ItemType Directory -Path $directory -Force | Out-Null
    $hash = (Get-FileHash -LiteralPath $Client.Icon -Algorithm SHA256).Hash
    $destination = Join-Path $directory ($hash + '.ico')
    if (-not (Test-Path -LiteralPath $destination) -or (Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash -ne $hash) {
        Copy-Item -LiteralPath $Client.Icon -Destination $destination -Force
    }
    return $destination
}
