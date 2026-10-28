# 通用青龙 Cookie 采集中心 · Quantumult X

> 状态（2026-10-27）：127 Portainer 的 `ql-capture-gateway` Stack（ID 45）已上线；公网 HTTPS 端到端验收通过。当前 **`DRY_RUN=true`，绝不更新青龙**。233 青龙已有专用 `envs` API 应用，但尚未填入 Portainer Stack 的 `QL_CLIENT_ID`、`QL_CLIENT_SECRET`。真实 iPhone 顺丰会话未完成实机验收。

- 网关：`https://qlcap.781751.xyz:58443`
- [健康检查](https://qlcap.781751.xyz:58443/health)
- 在线脚本版本：`v1.1.0`（在初始化/诊断通知中显示）
- 源码目录：`quantumultx/ql-capture/`
- **仅在本机配置 CAPTURE_TOKEN，不要上传 GitHub，也不要发送到公开聊天。**

## 家里 GitHub Raw 访问超时：改用自建镜像（2026-10-27）

若家庭网络访问 `raw.githubusercontent.com` 间歇性超时，**在 QX 中使用这条镜像主配置**，不再引用 GitHub Raw：

```text
https://qlcap.781751.xyz:58443/qx/qx-cookie-only.conf
```

镜像主配置内的 Rewrite、采集脚本、在线初始化、状态检查和开启/关闭任务都指向同一台自建服务器上的 `/qx/` 静态资源。已分别在 mcphome 和办公室进行 HTTPS 200 验收，TLS 正常，且不改变原有 `/api/v1/` Cookie 网关接口。GitHub 仓库依然是源码位置。

**同步限制**：当前镜像是服务端已部署版本；GitHub 推送更新后，需要在 mcphome 同步发布到静态镜像（`runtime/ql-capture-gateway/deploy_qx_mirror.py`），不是 GitHub 提交后实时自动同步。更新 QX 远程主配置需在 QX 中刷新/重新下载，不要把私密令牌提交到 GitHub。

## 重要：更新主配置会覆盖 QX MitM 证书

QX 的 MitM 私有 CA 数据保存在主配置 `[mitm]` 下的 `passphrase`、`p12`。本仓库及自建 `/qx/qx-cookie-only.conf` 是**公开配置**，不含这两项，因此每次用在线主配置**覆盖**本地主配置，都会丢失证书设置，要求重新导入。

**正确用法（仅初始化主配置一次）**：
1. 初次导入 `https://qlcap.781751.xyz:58443/qx/qx-cookie-only.conf`，在 QX 上生成、安装并信任证书。
2. 在 QX 本机主配置的 `[mitm]` 下确认已保存 `passphrase` 和 `p12`，并备份包含它们的配置到**私人加密位置**（不能上传公开 GitHub 或公开镜像）。
3. **后续不要再次覆盖下载主配置。** 仅刷新 `[rewrite_remote]` 的在线重写，以及已有 `[task_local]` 指向的在线 JS；脚本在服务器端更新即可。
4. 仅当需要修改主配置的结构时，先备份证书信息，在本机合并修改，保证 `[mitm]` 中保留原有 `passphrase`/`p12`，而不是用公开模板直接覆盖。

QX 应用里的系统“证书信任”并不能代替主配置中的私有 CA 数据。公开服务端应永远不保存或接收私有 CA 的 `p12` 和密码短语。

## 一键导入专用 QX 主配置（推荐）

仅用 Quantumult X 抓 Cookie、没有其他节点/代理业务时，可以直接用完整的在线主配置：

```text
https://raw.githubusercontent.com/masakacj/QLScriptPublic/main/quantumultx/ql-capture/qx-cookie-only.conf
```

该配置是 **无代理节点、默认 DIRECT** 的最小主配置，已内置顺丰 Rewrite 远程资源和四个在线交互任务（QL Setup / QL Status / QL Arm / QL Disarm）。在 QX「设置 → 配置文件 → 下载/远程资源」导入该 URL，并切换启用；不需要再单独导入同一条 Rewrite 或逐条添加任务，否则可能出现重复。主配置更新后需手动刷新/重新下载以获得新版；QX 可能不会自动把本地主配置替换为上游最新版。

**重要**：切换主配置前备份旧配置。在线主配置不包含、不应包含个人 CA 证书和密钥，导入后仍需在 QX 设置中安装并信任 MitM 证书，开启 QX Tunnel、重写、MitM、任务开关。纯 DIRECT 模式仍会通过 QX VPN 处理流量以支持 HTTPS 抓包，不提供代理翻墙功能。不要将 `CAPTURE_TOKEN` 写入公开主配置。首次绑定使用 Setup 交互任务的临时 `#token=...`，执行成功立刻移除参数，详见后文。

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

## 比亚迪海洋（已整合原有 QX 采集中心）

比亚迪规则已加入原来的 `rewrite.conf` 和 `capture.js`，与顺丰共享原有 QL Arm、QL Status。**不需要新增 BYD 重写资源，也不要添加 BYD Toggle/Status 任务。** 

在手机现有 QX 中只需刷新原有 Rewrite 远程资源，并保证 `[mitm]` 的 `hostname` 同时含 `mcs-mimp-web.sf-express.com` 与 `mina.bydoceanauto.com`。请仅合并 hostname，不要下载覆盖整份主配置，否则会丢失私有 CA `p12` 和 `passphrase`。

使用现有 **QL Arm** 开启持续抓取，打开比亚迪海洋微信小程序触发 `POST https://mina.bydoceanauto.com/?service=mina.decryptCode`。抓到合法 AES/Base64 响应后提示「比亚迪登录响应已保存」；在现有 **QL Status** 中可以看到「比亚迪：本地已抓取（未同步青龙）」。该测试版仅保存至 QX 本机偏好设置，不自动上传到网关或青龙。

目前 `qlcap.781751.xyz` 的 QX 静态镜像若尚未同步，需要先在服务端刷新镜像，**仅刷新手机旧镜像不会自动获取 GitHub 的最新代码**。可以暂时把已有 Rewrite 资源 URL 切换为 GitHub Raw 的 `https://raw.githubusercontent.com/masakacj/QLScriptPublic/main/quantumultx/ql-capture/rewrite.conf`（替换现有 URL，不是额外新增资源），确保刷新成功后继续测试。
## 完整 HTTP 请求/响应链路诊断（BYD 首批支持）

该能力复用现有 **QL Arm / QL Status / QL Disarm + capture.js + rewrite.conf**，无须向 QX 添加其他 JS 文件或任务。新建独立的受认证诊断服务，和正常的青龙变量同步逻辑隔离。

- 适用范围：仅在 MitM 白名单内的 `mina.bydoceanauto.com`；不能监听任意手机 App 或整个网络。
- 阶段：请求头、请求体、响应头、响应体。QX 使用 `sessionIndex` 关联同一次请求；缺失则标识关联不确定。
- 内容：URL、方法、HTTP 状态、全部可获取的文本请求与响应正文、相关请求与响应头。大于 QX 或采集端限制的正文会标明截断；空正文和二进制正文可能无法由 Rewrite 完整获取。
- 安全：两端分别确认后，**最多 10 分钟**上传；接收端只存内存、限量、过期删除；不在通知、GitHub、一般 QX 日志或普通公网 API 中输出原文。
- 解密：小程序自身 AES 加密的正文保留原文，由 mcpdebian 的授权分析程序在内存中解码，返回脱敏的字段结构和业务结果。

### 开始一次调试

1. 管理端通过 mcpdebian/Portainer 对指定域名启动 10 分钟采集窗口（服务器默认关闭）。
2. QX 刷新当前唯一的 Rewrite 资源和同名远程脚本，不覆盖主配置/CA 证书。
3. 执行**原有的 QL Arm**；只有服务器已开启诊断时，手机才开启相应的短期上传窗口。
4. 打开目标小程序，按平常流程访问「我的」「积分」等页面；已签到的当天**不要再次签到**。
5. 运行原有 **QL Status**，检查「深度诊断剩余秒数」和「已上传事件数」；管理端使用私有诊断命令查看请求/响应关联数据。
6. 结束时运行 **QL Disarm**，并由管理端关闭服务器会话（立即清空内存中的捕获数据）；自然过期也会自动清理。

已授权的真实会话及请求头可能包含 Cookie、手机号和身份令牌，请勿把 HTTP Analyzer 原文截图或捕获数据提交到公开仓库。调试仅限自己有权限访问的账户和服务。
