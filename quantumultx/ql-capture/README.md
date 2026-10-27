# 通用青龙 Cookie 采集中心 · Quantumult X

> 状态（2026-10-27）：127 Portainer 的 `ql-capture-gateway` Stack（ID 45）已上线；公网 HTTPS 端到端验收通过。当前 **`DRY_RUN=true`，绝不更新青龙**。233 青龙已有专用 `envs` API 应用，但尚未填入 Portainer Stack 的 `QL_CLIENT_ID`、`QL_CLIENT_SECRET`。真实 iPhone 顺丰会话未完成实机验收。

- 网关：`https://qlcap.781751.xyz:58443`
- [健康检查](https://qlcap.781751.xyz:58443/health)
- 在线脚本版本：`v1.1.0`（在初始化/诊断通知中显示）
- 源码目录：`quantumultx/ql-capture/`
- **仅在本机配置 CAPTURE_TOKEN，不要上传 GitHub，也不要发送到公开聊天。**

## 1. 重写和 HTTPS 解密（已配置可跳过）

打开 Quantumult X → 设置 → 重写 → 资源，添加远程 Rewrite：

```text
https://raw.githubusercontent.com/masakacj/QLScriptPublic/main/quantumultx/ql-capture/rewrite.conf
```

启用 QX Tunnel/VPN、重写、MitM；安装并信任 **QX 自己生成的证书**。解密域名只需 `mcs-mimp-web.sf-express.com`，不使用全局 MitM。此域名的实际请求是否可被 QX 捕获取决于 iOS、小程序流量和其网络实现。

## 2. 全在线的交互任务（不需要在手机保存 JS 文件）

在 QX「设置 → 工具与分析 → HTTP 请求」添加以下 4 个**交互任务**，或者把这些行加入现有配置的 **`[task_local]`** 分区（不要重复添加分区头）：

```ini
[task_local]
event-interaction https://raw.githubusercontent.com/masakacj/QLScriptPublic/main/quantumultx/ql-capture/setup-online.js, tag=青龙采集初始化, enabled=true
event-interaction https://raw.githubusercontent.com/masakacj/QLScriptPublic/main/quantumultx/ql-capture/status.js, tag=青龙采集状态, enabled=true
event-interaction https://raw.githubusercontent.com/masakacj/QLScriptPublic/main/quantumultx/ql-capture/arm.js, tag=青龙开启采集, enabled=true
event-interaction https://raw.githubusercontent.com/masakacj/QLScriptPublic/main/quantumultx/ql-capture/disarm.js, tag=青龙关闭采集, enabled=true
```

远程脚本由 GitHub Raw 获取。首页长按策略节点（或从 HTTP 请求任务列表手动运行）唤起交互操作。运行交互任务时要开启 QX Tunnel 和任务功能。

### 只需一次的密钥初始化

首先在自己的 Portainer 打开 `Stacks → ql-capture-gateway → Environment variables`，获取 `CAPTURE_TOKEN`。**它不是 Portainer Token，也不是青龙 Client Secret。**

临时把「青龙采集初始化」的脚本地址改成（把示例字段替换为真正的 `CAPTURE_TOKEN`）：

```ini
event-interaction https://raw.githubusercontent.com/masakacj/QLScriptPublic/main/quantumultx/ql-capture/setup-online.js#token=你的CAPTURE_TOKEN, tag=青龙采集初始化, enabled=true
```

执行一次，看到 **「初始化成功」** 后，**立刻编辑任务把 `#token=...` 删掉**，恢复本节第一个示例中的无参数 URL。

- QX 会从 `$environment.sourcePath` 读取 `#token=`，在线脚本先检查网关鉴权；确认成功后才将服务地址、密钥保存到 QX 的 `$prefs`，并关闭本轮采集。鉴权失败不会覆盖旧配置。
- URL 片段（`#...`）不会发到 GitHub HTTP 服务，但在你**删掉之前**会保留在 QX 任务配置中，可能随 QX 设置同步到 iCloud；完成后请立即移除。
- 后续更新或重新运行在线初始化脚本时，如果没有 `#token=`，则**只检查现有配置**，不要求再次输入密钥。
- 不要把带有 `#token=` 的 URL 粘贴到聊天、Issue、日志或 GitHub。

旧的 [setup.js](./setup.js) 本地模板保留给离线用户。**现在推荐使用 [setup-online.js](./setup-online.js)**。

## 3. 平时怎么用

1. 执行「青龙采集状态」：验证服务连通、是否 `DRY_RUN`、本次采集是否开启。
2. 执行「青龙开启采集」：QX 会将一次性开关置为启用。
3. 打开已登录的顺丰小程序 / 积分 H5，访问积分或签到页面。只有请求经过 QX、命中 `mcs-mimp-web.sf-express.com` 且带齐三个字段（`sessionId`、`_login_mobile_`、`_login_user_id_`）时，才会提交到你自己的网关。
4. 收到「测试捕获成功」通知后可执行状态脚本复查；未完成时可执行「青龙关闭采集」。

**当前测试模式不会更改青龙。** 即使 QX 提示测试捕获成功，也只代表抓到必要字段并通过网关格式校验，**不代表顺丰会话真实有效**。未完成真实业务接口校验和青龙凭据配置前，不要关闭 `DRY_RUN`。

## 4. 在线版本更新和排错

- 后续修改 `setup-online.js`、`status.js`、`arm.js`、`disarm.js`、`capture.js`，只需推送 GitHub；**手机不必重建本地 JS 文件**。
- QX 有脚本缓存。更新后在「HTTP 请求」刷新相应脚本，或者在 QX 资源更新界面刷新脚本缓存；Rewrite 资源也可单独刷新。在线初始化和状态脚本的通知标题会显示版本号，例如 `v1.1.0`。
- GitHub 新增了 [QX Cookie Capture Tests](../../../.github/workflows/qx-capture-tests.yml) 自动检查：每次修改该目录的 JS，检查语法并执行 8 项模拟 QX 交互测试。也可用 Node.js 本地执行 `node quantumultx/ql-capture/test.cjs`。该测试不含真实密钥，不代替 iPhone 实机测试。
- 「青龙采集状态」可区分：未配置、401 密钥错误、HTTPS 不通、正常 `DRY_RUN`、正式模式等，不输出 Token 或 Cookie。
- QX 已配置成功但捕不到顺丰：检查 MitM 证书信任、重写是否启用、请求是否进入 QX VPN，以及实际请求域名。仅打开 `ucmp.sf-express.com/v1/we/cx3.0/mine` **不会**触发当前顺丰规则。
- 接收网关只允许经 HTTPS 上报明确白名单字段，不捕获整个域名的所有 Cookie；添加其他平台需增加显式白名单，不要使用通配来源。
- [网关健康检查](https://qlcap.781751.xyz:58443/health) 返回 HTTP 200 仅代表程序在线，不代表凭据已有效或可正式写入青龙。

## 服务端运维

Portainer（127）Stack `ql-capture-gateway`、青龙（233）独立 `envs` 应用。HTTPS 使用已有 NPM 的 `*.781751.xyz` 证书和宿主端口 58443；当前 NPM 路由是自定义 vhost（不显示在普通 Proxy Hosts 列表）。不可把 Portainer 或 QingLong 凭据放到公开仓库。
