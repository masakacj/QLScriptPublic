# DevSpace Windows 后台一键修复 / 安装

面向 mcphome、mcpoffice 以及其他原本使用 Windows PowerShell 手动启动 `@waishnav/devspace` 的机器。复用各机现有 Node.js、DevSpace CLI、`.devspace` 授权/配置和 SQLite 状态。**不会**重装程序、修改 Cloudflare Tunnel、重置 OAuth 或读取/复制凭据。Linux 上已有正常的 systemd 服务无需执行此脚本。

## 一键在线操作

在目标机器用**原来的 Windows 用户账户**（mcphome 为 masak，mcpoffice 为 Administrator）登录，以同一用户运行 **管理员 PowerShell**。不要在当前 DevSpace MCP Shell / SYSTEM 中执行（部署会短暂中断现有 MCP）。

下列多条 PowerShell 语句可作为**一个代码块一次粘贴**。先试 GitHub raw；若不可用则自动用 GitHub 官方 Contents API：

~~~powershell
$raw='https://raw.githubusercontent.com/masakacj/QLScriptPublic/main/tools/devspace/install.ps1'
$api='https://api.github.com/repos/masakacj/QLScriptPublic/contents/tools/devspace/install.ps1?ref=main'
$src=$null
try { $src=(Invoke-WebRequest -UseBasicParsing -Uri $raw -TimeoutSec 8).Content }
catch {
    $j=(Invoke-WebRequest -UseBasicParsing -Uri $api -Headers @{'User-Agent'='DevSpace-OneClick'} -TimeoutSec 25).Content | ConvertFrom-Json
    $src=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String(($j.content -replace '\s','')))
}
& ([scriptblock]::Create($src))
~~~

默认模式是 **Boot**（开机即后台运行，即使还没登录 Windows）：
- 只在本机要求输入一次当前 Windows 帐号的真实密码以注册任务计划程序。不是 Windows Hello PIN。
- 以**真实的当前用户身份**运行，不再采用 SYSTEM 伪造 USERPROFILE 的兼容方案。
- 后台且不弹出前台 PowerShell。任务启动后可以关闭安装窗口。
- 每次启动 DevSpace 时刷新机器级和用户级环境变量（包含已有 Portainer/Git 相关变量的键值，**不会显示或复制其内容**）。
- 守护 Node/7878，检测失败时受限重启，保护现有端口归属；保留旧任务定义，以便迁移失败时尽可能恢复。
- 在开始迁移前只读核对 Node、CLI、进程和授权文件存在性；GitHub 在线下载的管理器必须匹配安装器内固定 SHA-256。
- 若不要求开机无人登录运行，可在最后一行改成：
  `& ([scriptblock]::Create($src)) -Mode Logon`（登录后启动，无须提供 Windows 密码）。
- 若只想预检，可将最后一行改成：
  `& ([scriptblock]::Create($src)) -CheckOnly`。

## 已验证

2026-10-27：GitHub 安装器的 **-CheckOnly** 在 mcphome 和 mcpoffice 两端都通过：
- mcphome：raw 连接超时后走 GitHub 官方 API，SHA-256 验证通过；发现运行主体 masak、原进程 7878 以及用户级 Portainer 变量。
- mcpoffice：raw 直接可用、SHA-256 验证通过；发现远端 MCP 身份为 SYSTEM，实际部署必须在 Administrator 本机登录后运行。
- **未进行生产安装/迁移验收**。迁移会终止原先的 DevSpace Node 进程，因此不要从需要被切换的 MCP 连接中启动迁移。

## 以后的本地检查 / 启停

成功安装后，管理器常驻文件路径为：

`%LOCALAPPDATA%\DevSpaceManaged\devspace-managed.ps1`

本机同一 Windows 用户的 PowerShell：

~~~powershell
$script = "$env:LOCALAPPDATA\DevSpaceManaged\devspace-managed.ps1"
& $script -Action Doctor
& $script -Action Restart
& $script -Action Stop
& $script -Action Start
~~~

重新执行上方在线命令可以重新部署/覆盖原 Windows 任务（Boot 会再次要求 Windows 账户密码）。`-Action Uninstall` 仅清理本管理器创建的任务，保留 DevSpace 配置和授权。

## OAuth 有效期说明

DevSpace 当前实现的 access token 默认有效期约 1 小时、refresh token 30 天，refresh token 支持轮换。后台运行、采用真实用户及持久 SQLite 状态能避免进程中断和 SYSTEM 访问错误，但**不等于强行延长或永久保活 ChatGPT 客户端 OAuth 授权**。客户端刷新失败仍需独立检查，不能把本地 `/healthz` 200 当成 OAuth 成功。

## 安全说明

安装器公开源码，不包含设备专属 Token、密码或 Cookie。下载后通过 SHA-256 固定校验管理器，避免镜像缓存、下载错误和文件被意外替换。**脚本拥有重启目标 DevSpace 进程的权限**，建议先查看 [install.ps1](./install.ps1)、[devspace-managed.ps1](./devspace-managed.ps1)，再在本机执行。Windows 保留原用户名 SID，不迁移凭据、不降级到 SYSTEM 身份。
