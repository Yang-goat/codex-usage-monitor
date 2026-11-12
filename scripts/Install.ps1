param(
    [string]$ShortcutPath = (Join-Path ([Environment]::GetFolderPath('Desktop')) 'Codex.lnk'),
    [string]$AppPath,
    [string]$NodePath,
    [string]$CliPath,
    [ValidateRange(1024,65535)][int]$Port = 9339
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Common.ps1')
$client = Get-MonitorClient -AppPath $AppPath
$null = Get-MonitorNode -NodePath $NodePath
$null = Get-MonitorCli -CliPath $CliPath -ClientExe $client.Exe
$ShortcutPath = [IO.Path]::GetFullPath($ShortcutPath)
if ([IO.Path]::GetExtension($ShortcutPath) -ne '.lnk') { throw '-ShortcutPath 必须是 .lnk 快捷方式。' }
if (-not (Test-Path -LiteralPath (Split-Path $ShortcutPath -Parent) -PathType Container)) { throw '快捷方式所在目录不存在。' }
$shell = New-Object -ComObject WScript.Shell
$oldRecord = Get-MonitorRecord
$backup = Join-Path $script:MonitorRuntime 'shortcut.original.lnk'
$hadOriginal = Test-Path -LiteralPath $ShortcutPath -PathType Leaf
$originalHash = $null
$currentHash = if ($hadOriginal) { (Get-FileHash -LiteralPath $ShortcutPath -Algorithm SHA256).Hash } else { $null }
if ($oldRecord) {
    if ($oldRecord.ShortcutPath -ne $ShortcutPath -or $oldRecord.Root -ne $script:MonitorRoot) { throw '本目录已有另一项安装记录。请先在原目录卸载，再重新安装。' }
    if ($currentHash -notin @($oldRecord.InstalledHash,$oldRecord.OriginalHash)) { throw '快捷方式在安装后发生了其他修改，未覆盖。' }
    $hadOriginal = [bool]$oldRecord.HadOriginal
    $originalHash = $oldRecord.OriginalHash
    if ($hadOriginal -and (-not (Test-Path -LiteralPath $backup) -or (Get-FileHash -LiteralPath $backup -Algorithm SHA256).Hash -ne $originalHash)) { throw '原快捷方式备份缺失或校验失败，停止安装。' }
} elseif ($hadOriginal) {
    $oldLink = $shell.CreateShortcut($ShortcutPath)
    $folder = (New-Object -ComObject Shell.Application).Namespace((Split-Path $ShortcutPath -Parent))
    $item = $folder.ParseName([IO.Path]::GetFileName($ShortcutPath))
    $parsing = $item.ExtendedProperty('System.Link.TargetParsingPath')
    $matchesPackage = $client.PackageFamily -and $parsing -and $parsing.StartsWith($client.PackageFamily + '!')
    if ($oldLink.TargetPath -ne $client.Exe -and -not $matchesPackage) { throw '现有快捷方式无法核实为 Codex。未覆盖；请用 -ShortcutPath 指定一个未占用的新文件名。' }
    New-Item -ItemType Directory -Path $script:MonitorRuntime -Force | Out-Null
    if (Test-Path -LiteralPath $backup) { throw '备份已存在但缺少安装记录，未覆盖备份。' }
    Copy-Item -LiteralPath $ShortcutPath -Destination $backup
    $originalHash = $currentHash
    if ((Get-FileHash -LiteralPath $backup -Algorithm SHA256).Hash -ne $originalHash) { throw '备份校验失败，停止安装。' }
}
New-Item -ItemType Directory -Path $script:MonitorRuntime -Force | Out-Null
$prepared = Join-Path $script:MonitorRuntime 'shortcut.prepared.lnk'
$link = $shell.CreateShortcut($prepared)
$link.TargetPath = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$link.Arguments = '-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + (Join-Path $PSScriptRoot 'Start.ps1') + '"'
$link.WorkingDirectory = $script:MonitorRoot
$link.WindowStyle = 7
$link.IconLocation = Get-MonitorStableIcon $client
$link.Description = 'Codex；自动加载用量监控，完全退出客户端后辅助进程自动退出。'
$link.Save()
if (Test-Path -LiteralPath $ShortcutPath) {
    if ((Get-FileHash -LiteralPath $ShortcutPath -Algorithm SHA256).Hash -ne $currentHash) { throw '准备期间快捷方式发生变化，未替换。' }
} elseif ($null -ne $currentHash) { throw '准备期间快捷方式已被移走，停止安装。' }
$record = [ordered]@{
    Root=$script:MonitorRoot;ShortcutPath=$ShortcutPath;HadOriginal=$hadOriginal;OriginalHash=$originalHash
    InstalledHash=(Get-FileHash -LiteralPath $prepared -Algorithm SHA256).Hash;State='prepared'
    Settings=@{AppPath=$AppPath;NodePath=$NodePath;CliPath=$CliPath;Port=$Port}
}
Write-MonitorRecord $record
Copy-Item -LiteralPath $prepared -Destination $ShortcutPath -Force
if ((Get-FileHash -LiteralPath $ShortcutPath -Algorithm SHA256).Hash -ne $record.InstalledHash) { throw '快捷方式安装校验失败，请运行 Uninstall.ps1 恢复。' }
$record.State = 'installed'
Write-MonitorRecord $record
Write-Output "安装完成：$ShortcutPath"
Write-Output '请在任务结束后正常退出 Codex，再双击这个图标。无需另外启动监控程序。'
