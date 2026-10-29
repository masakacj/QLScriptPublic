# QX → 青龙：持续凭据采集（v2）

**默认规则：Quantumult X Tunnel 开着 + Rewrite/MitM 正常，就持续抓取。** 无需先执行 Arm、准备授权，也没有 10 分钟倒计时。手动执行 QL Disarm 可暂停；QL Arm 可恢复。QX Tunnel 关闭时抓取自然停止。

## 目前支持

| 来源 | QX 捕获条件 | 用途 |
|---|---|---|
| 顺丰 | `mcs-mimp-web.sf-express.com` 带所需登录 Cookie 的请求 | 原有网关写入 `sfsyUrl`（保留原恢复逻辑） |
| 夸克 | `drive-m.quark.cn` 成长/签到请求包含 `kps/sign/vcode` | 只读校验通过后更新已有单账号 `COOKIE_QUARK`，原任务 2255 保持不变 |
| 比亚迪海洋 | 小程序登录响应/签到请求的加密字段 | 先保存 QX 本地候选，**不自动修改青龙** |
| 中国移动 | `wx.10086.cn` 的签到/活动请求 Cookie | 仅保存 QX 本地候选；青龙签到由 YYB-Go 自动登录完成 |

- 只有实际经过 QX、命中 HTTPS 重写并成功 MitM 的请求才会被抓取。**QX 开着不代表其他 App 一定有产生对应请求**。
- 夸克的 `kps/sign/vcode` 来自 **夸克移动端**，不是普通网页 Cookie；需要在已登录的夸克 App 打开网盘签到/成长任务页面。抓到有效凭据会验证并写入青龙（多账号时因账号映射不明确不会盲目覆盖）。
- 夸克脚本若之前的定时日志显示“获取成长信息失败”，且新的凭据校验通过，网关会补跑一次任务 2255；否则保持每天 09:00 的原定时任务。
- 永不把 Token、Cookie、私有 CA、手机号或请求原文写入 GitHub、普通日志或 QX 通知。
- 网关仍保留最基本的 **HTTPS + Bearer + 域名/字段白名单**，减少控制步骤并不意味着向外开放管理接口。

## QX 已有用户如何升级

1. **不要用公开主配置覆盖当前配置**，否则可能丢失 QX 私有 MitM 证书的 `p12` / `passphrase`。仅刷新已有 Rewrite 远程资源，以及 Setup/Status/Arm/Disarm 的在线 JS。
2. 在当前 QX `[mitm]` 的 hostname 中**追加** `drive-m.quark.cn`，保留原有域名和私有 CA；在 `[filter_local]` 中可增加 `host, drive-m.quark.cn, direct`。
3. 确保 QX Tunnel、MitM、Rewrite、任务开关开启。运行一次 **QL Status**，确认网关已显示 `quark` 服务，采集状态显示“默认开启”（除非之前主动 Disarm）。
4. 打开夸克 App 已登录账号的网盘「每日签到/成长」页面，使其发送对应移动端请求。QX 仅在参数发生变化时上传，收到“夸克凭据已更新”才代表已写入青龙。
5. 若旧 QX 状态为“暂停”，只需运行一次 QL Arm；以后日常不需要点击 Arm。关闭 QX Tunnel 即停止拦截；再开启自动恢复。

新用户可使用自建主配置作为模板：
`https://qlcap.781751.xyz:58443/qx/qx-cookie-only.conf`

请在 QX **本机**初始化网关 CAPTURE_TOKEN，切勿将其粘贴进公开 URL/仓库。已有配置不用重复 Setup。

## QX 操作逻辑

- **QL Status**：只读检查网关与最近抓取结果（不展示具体凭据）。
- **QL Arm**：手动恢复日常持续抓取，平时不必操作。
- **QL Disarm**：持久暂停，直到手动 Arm。
- 原有 10 分钟 **深度 HTTP 请求/响应诊断**仍为独立开发工具，不再和日常 Arm 绑定。需要时可单独添加 `debug-arm.js` 交互任务；它仍使用临时诊断窗口，原文不进入普通 Cookie 网关。

## 部署和运维

QX 公共源码位置：`quantumultx/ql-capture/`。家用网络优先使用镜像 `https://qlcap.781751.xyz:58443/qx/`；其静态文件由 mcpdebian 的镜像同步工具部署。GitHub 更新不会自动覆盖手机上的 CA 设置。

青龙原任务：顺丰、夸克等保持原 ID 和 Cron；夸克环境变量继续是 `COOKIE_QUARK`，由同一个已登录的 QX 客户端捕获新参数。历史 Cookie 不输出到通知，单账号覆盖保留原 user 名称。

多账号夸克自动匹配与 iOS 夸克客户端证书固定行为仍需另行实机核验，当前不猜测支持。
