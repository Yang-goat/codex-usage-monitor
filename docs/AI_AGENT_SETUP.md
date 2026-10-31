# 给 AI Agent 的自动安装提示词

将下面整段复制给能够执行本机命令的 AI Agent。安装不需要额外 API Key；需要用户已经安装并登录 Codex 桌面端。

```text
请帮我下载并安装 Codex 用量监控：
https://github.com/Yang-goat/codex-usage-monitor

目标：以后只点已接入的桌面 Codex 图标，客户端和监控一起启动；完全退出客户端后监控自动退出。当前只需要中文界面。

先读取 README.md、AGENTS.md 以及 scripts/Common.ps1、Install.ps1、Start.ps1、Uninstall.ps1，然后执行：

1. 记录 Windows、PowerShell、Node.js 与 Codex 安装状态。需要 Node.js 22+。保留现有 Python、Node 与其他项目环境；缺少依赖时说明缺项和安装方式。
2. 优先下载仓库最新正式 Release 的 Windows ZIP 和 SHA256SUMS.txt，核对 SHA-256 后解压到适合长期保留的独立目录；没有 Release 时再 clone 源码。不使用临时目录，不覆盖现有项目。已有 clone 时先检查 git status 再决定如何更新。
3. 本项目无 npm 生产依赖，不运行不必要的 npm install。执行：
   powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\Start.ps1 -CheckOnly
4. 自动发现失败时，用实际路径设置 -AppPath / -NodePath / -CliPath；AppPath 必须是桌面 ChatGPT.exe 或 Codex.exe，不能是 CLI codex.exe。CLI 缺失可以继续安装，仅实时额度可能不可用。
5. 执行 scripts/Install.ps1。它只会接入已核实的 Codex.lnk，替换前保存原始备份和哈希。如果同名图标不能核实，使用一个未占用的新 .lnk 路径，不绕过保护直接覆盖。
6. 若端口 9339 被其他程序占用，使用 -Port 选择空闲端口。只允许本机回环监听，不转发或暴露调试端口。
7. 不强制结束或重启正在运行的 Codex，不发送聊天消息，不修改客户端资源、全局配置或登录文件。配置完成后告诉我正常退出全部客户端及托盘实例，再从已接入的图标重开；只有我同意后才做需要切换模式或重启的实际界面检查。
8. 不读取、复制、打印或上传 auth.json、Token、完整会话日志或会话数据库。不要为诊断打包整个 runtime/。

最后告诉我：安装目录、接入的图标路径、启动方法、卸载命令、实际执行的检查，以及仍需我确认的客户端兼容情况。卸载使用 scripts/Uninstall.ps1，保留原图标备份；不要擅自清理聊天和缓存。
```
