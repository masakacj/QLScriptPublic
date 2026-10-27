# 通用青龙 Cookie 采集（Quantumult X）

**当前状态（2026-10-27）**：服务端已在家庭 Portainer 的 `ql-capture-gateway` Stack（ID 45）启动，容器健康状态 `healthy`；公网 HTTPS 已通过实际请求验证：

- 服务地址：`https://qlcap.781751.xyz:58443`
- [健康检查](https://qlcap.781751.xyz:58443/health) 返回 HTTP 200。
- 已验证未授权访问返回 401、合法模拟 Cookie 返回 `dry_run`、来源域名不在白名单时返回 400。
- **仍处于 `DRY_RUN=true`，不修改青龙。** 青龙已建立 `envs` 专用 API 应用，但其凭据尚未填入 Portainer Stack。真实顺丰 Cookie 尚未通过 iPhone 实测，也尚未建立正式业务接口有效性校验。不要擅自关闭 DRY_RUN。

## 1. 安装远程重写规则

在 iPhone 的 Quantumult X 中：

1. 开启 QX VPN/Tunnel。若还没有配置过 HTTPS 解密，请在「设置 → MitM/HTTPS 解密」生成/安装并于 iOS「设置 → 通用 → 关于本机 → 证书信任设置」信任 **QX 自己生成的证书**。
2. 在「设置 → 重写 → 资源/引用」添加下面 **rewrite.conf** 的 Raw 地址，标签可用「青龙凭证采集」，资源解析器关闭（`opt-parser=false`），开启此资源。
3. 确认 `mcs-mimp-web.sf-express.com` 已出现在 MitM 主机名列表；不要启用所有域名的解密。

远程重写地址：

```text
https://raw.githubusercontent.com/masakacj/QLScriptPublic/main/quantumultx/ql-capture/rewrite.conf
```

如果使用配置文件编辑器，也可以在现有的 `[rewrite_remote]` 下增加：

```ini
https://raw.githubusercontent.com/masakacj/QLScriptPublic/main/quantumultx/ql-capture/rewrite.conf, tag=青龙凭证采集, update-interval=86400, opt-parser=false, enabled=true
```

**注意**：`rewrite.conf` 是远程重写资源，不应拿来覆盖原 QX 完整配置，也不要把 `capture.js` 链接直接添加为重写资源。

## 2. 本机一次性初始化（接收服务已上线）

公开 `setup.js` 文件只是模板，**不能直接远程运行**（里面没有你的私有域名和密钥）。

- 将 [setup.js](./setup.js) 复制到 iPhone 的 `Quantumult X/Scripts` 中，本地编辑 `SERVER_URL` 和 `CAPTURE_TOKEN`。填写 `SERVER_URL='https://qlcap.781751.xyz:58443'`；`CAPTURE_TOKEN` 需从 **Portainer 的 ql-capture-gateway Stack → Environment variables** 获取（长度至少 32 字符）。不要使用 Portainer API Token 代替它。
- 在 QX「HTTP 请求」中创建指向该 **本地文件** 的脚本任务并手动运行一次，看到「配置已保存」提示。
- 千万不要把填写密钥后的本地文件提交至公开 GitHub；`capture.js`、`rewrite.conf` 不需要密钥修改。

## 3. 每次手动捕获

把 `arm.js`、`disarm.js` 的 Raw 链接添加到 QX「HTTP 请求」作为可手动执行的脚本任务。QX 通常可通过任务左滑执行（UI 版本不同）；不需要安排每日定时开启采集。

开启：
```text
https://raw.githubusercontent.com/masakacj/QLScriptPublic/main/quantumultx/ql-capture/arm.js
```
关闭：
```text
https://raw.githubusercontent.com/masakacj/QLScriptPublic/main/quantumultx/ql-capture/disarm.js
```

使用顺序：手动运行 `arm.js` → 在已登录的顺丰小程序或官方积分 H5 打开会员积分/签到页 → QX 检查符合白名单的请求 → 将**仅三个字段** `sessionId`、`_login_mobile_`、`_login_user_id_` 传至你自己的网关 → 网关验证并返回回执 → 成功后自动关闭采集。可手动运行 `disarm.js` 随时中止。自动关闭仅发生在网关返回明确的成功/测试回执时。

## 4. 验收与排错

- QX 规则命中，不代表登录凭据一定有效；小程序可能不经 QX 隧道，或者不允许解密。
- `https://ucmp.sf-express.com/v1/we/cx3.0/mine` 只涉及 **ucmp** 域名时不触发本脚本。需从会员中心进入实际的 `mcs-mimp-web.sf-express.com` 会员积分接口。
- 只有看到网关返回 `synced` 或 `unchanged`，并在青龙查看 `sfsyUrl` 对应记录的更新时间，才算完成写入。初期 `dry_run` 不修改青龙。
- 真正验证 Cookie 应读取顺丰会员业务接口返回，而非仅检查是否包含手机号字段。失效时不得覆盖青龙旧变量，不得将任务误记成功。
- 不要通过截图、日志、Issue、Bark 通知暴露 Cookie、手机号全值、青龙密钥。

## 在线更新

QX 的 Rewrite 远程资源通过 GitHub Raw 自动更新（这里配置为 24 小时），也可以在资源页面手动刷新。脚本原始文件放在 `quantumultx/ql-capture/`；新增平台应以**明确的域名、路径、字段白名单**实现，禁止捕获全站/任意域名的完整 Cookie。

**服务端运维**：接收容器位于 Portainer Stack `ql-capture-gateway`，HTTPS 复用现有 Nginx Proxy Manager 网络及 58443 入口，使用独立的 NPM 自定义 vhost 配置（不在 NPM 常规 Proxy Hosts 页面显示）。Stack 的 `DRY_RUN` 与其他密钥均应仅在 Portainer 私有界面管理。正式写入前应完成 QL API 客户端凭据配置、真实顺丰会话有效性校验、过期会话不覆盖旧 Cookie 的验收和 iPhone 实机测试。

此项目仅供本人合法授权的账号使用；顺丰真实抓取及网关正式写入尚未在 iPhone 实机验证。
