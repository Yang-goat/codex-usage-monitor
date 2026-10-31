$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Common.ps1')
$record = Get-MonitorRecord
if (-not $record) { Write-Output '没有安装记录，无需卸载。'; return }
if ($record.Root -ne $script:MonitorRoot -or [IO.Path]::GetExtension($record.ShortcutPath) -ne '.lnk') { throw '安装记录与本目录不符，停止恢复。' }
$exists = Test-Path -LiteralPath $record.ShortcutPath -PathType Leaf
$currentHash = if ($exists) { (Get-FileHash -LiteralPath $record.ShortcutPath -Algorithm SHA256).Hash } else { $null }
if ($record.HadOriginal -and $currentHash -eq $record.OriginalHash) { $record.State='restored'; Write-MonitorRecord $record; Write-Output '原入口已恢复。'; return }
if ($exists -and $currentHash -ne $record.InstalledHash) { throw '快捷方式有后续修改，保留当前文件；未覆盖或删除。' }
if ($record.HadOriginal) {
    $backup = Join-Path $script:MonitorRuntime 'shortcut.original.lnk'
    if (-not (Test-Path -LiteralPath $backup) -or (Get-FileHash -LiteralPath $backup -Algorithm SHA256).Hash -ne $record.OriginalHash) { throw '原入口备份校验失败，停止恢复。' }
    Copy-Item -LiteralPath $backup -Destination $record.ShortcutPath -Force
    if ((Get-FileHash -LiteralPath $record.ShortcutPath -Algorithm SHA256).Hash -ne $record.OriginalHash) { throw '恢复后校验失败。' }
} elseif ($exists) {
    Remove-Item -LiteralPath $record.ShortcutPath
}
$record.State='restored'
Write-MonitorRecord $record
Write-Output '已恢复原启动方式。运行资料和备份保留在 runtime/，没有修改聊天、登录或 Codex 配置。'
Write-Output '如客户端仍在运行，本次已加载的状态条会随客户端完全退出而结束。'
