# Codex Usage Monitor · 安装 / Installation

[中文文档](https://github.com/Yang-goat/codex-usage-monitor#readme) · [English documentation](https://github.com/Yang-goat/codex-usage-monitor/blob/main/README.en.md)

## 简体中文

需要 Windows 10/11、PowerShell 5.1+、Node.js 22+ 和已登录的 Codex 桌面端。先用 Release 的 `SHA256SUMS.txt` 核对 ZIP，再解压到长期保留的目录。无需安装 npm 依赖。

在解压后的项目目录运行下面的启动检查和安装命令。安装完成后，正常退出 Codex 的所有实例，再从桌面 **Codex** 图标打开。设置里的「自动更新」会在发现可校验的新版后出现。

## English

Use Windows 10/11, PowerShell 5.1+, Node.js 22+, and a signed-in Codex desktop app. Compare the ZIP hash with the release's `SHA256SUMS.txt` and extract it to a permanent directory. There are no npm dependencies.

Run the startup check and installer below from the extracted directory. Fully quit Codex after installation, then reopen it from the desktop **Codex** shortcut. Select English from the gear menu. Auto-update appears when a verifiable newer version is available.

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\Start.ps1 -CheckOnly
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\Install.ps1
```

## 卸载 / Uninstall

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\Uninstall.ps1
```

保留 `runtime/`，其中存放快捷方式备份和语言设置。Keep `runtime/` for the shortcut backup and language preference.
