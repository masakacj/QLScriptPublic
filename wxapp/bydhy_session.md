# 比亚迪海洋签到 · 青龙 Session 凭据版

文件：`wxapp/bydhy_session.js`
来源：Smallfawn 小程序签名/加密/签到协议（`wxapp/bydhy.js`）。本脚本只适用于 **比亚迪海洋微信小程序**，不能假定兼容原生「比亚迪海洋」App 的 Cookie。

## 适用场景

不需要 `wx_server` 或微信 Code。青龙直接使用已经取得的有效 `session_id` 调用签入接口。为保留源脚本的行为，请确保账号已在小程序/比亚迪 App 完成注册与升级。

请在青龙环境变量管理中新建/更新变量：

- 名称：`bydhy`
- 值：以下任选一种（不要使用示例的假值）
  - `真实session_id`
  - `session_id=真实session_id`
  - `enc:mina.decryptCode接口响应体原始AES/Base64密文`
- 多账号使用换行或 `&` 分隔；可加 `#备注`。

计划任务示例（路径随青龙订阅目录调整）：

```shell
51 8 * * * node /ql/data/repo/masakacj_QLScriptPublic/wxapp/bydhy_session.js
```

上述路径仅为示例，实际应以青龙订阅下载后的位置为准。运行需要 Node.js、`axios`、仓库中的 `tools/env.js` 和已有通知模块。

## 如何取得凭据

1. 使用你已授权登录的 **比亚迪海洋微信小程序**；不是原生 App 登录。
2. 在 Quantumult X 启用已信任的 HTTPS MitM，**仅针对域名** `mina.bydoceanauto.com`；实际能否抓到流量取决于客户端的网络实现。
3. 查找小程序登录请求 `POST https://mina.bydoceanauto.com/?service=mina.decryptCode` 的 **响应正文**。响应体可能仍是 AES/Base64 密文，这是正常的（HTTPS 解密并不会消除应用层 AES 加密）。
4. 把该响应正文加前缀 `enc:` 放入青龙变量 `bydhy`。脚本运行时在本机解密、提取 `session_id`。如已有明确的 `session_id`，可直接填写它。
5. 在青龙手动运行一次该任务并核对签到结果；成功后保留每天定时执行。

提醒：加密响应包含可恢复的登录凭据，**不是安全的匿名数据**。不要放到 GitHub、公开日志或发送到聊天。QX 现有顺丰采集网关不自动识别该凭据，本版本尚未接入自动上报/自动换新。

## 过期和异常

- 凭据有效：按定时任务直接请求签到。
- 当服务器提示会话过期/未授权：日志显示需重新抓取（原脚本的 `wx_server` 重新登录分支已移除）。
- 原服务端返回 `ret=50010`：账号需要在比亚迪 App 完成升级/注册，更新凭据本身不能解决。
- 成功、重复签到、过期均通过已有 `tools/env.js` 的通知机制发送；Bark 投递取决于青龙通知配置。

## 离线验证

```shell
node --check wxapp/bydhy_session.js
node --test wxapp/bydhy_session.test.cjs
```

测试只使用模拟凭据与模拟 HTTP 响应，不会执行真实签到。请在真实登录样本下验收后再启用正式定时任务。
