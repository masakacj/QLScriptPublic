# HJD2048 iOS Userscripts 在线更新

本目录仅发布 **不含写入密钥** 的 Userscript 版本。

- [安装/手动更新](https://raw.githubusercontent.com/masakacj/QLScriptPublic/main/hjd2048/hjd2048-magnet-queue.user.js)
- [版本元数据](https://raw.githubusercontent.com/masakacj/QLScriptPublic/main/hjd2048/hjd2048-magnet-queue.meta.js)

## 首次迁移（必须先做）

旧版脚本的 Worker 私有写入授权保存在本地原脚本中。公开脚本故意不包含它，直接首次安装公网版会无法发送。

1. **不要删除旧脚本或清理 Userscripts 存储。** 先从 mcpoffice 取得私有迁移版 `D:\workspace\py\hjd2048-magnet-queue.user.js`（v4.1.0），以**同名、同文件**覆盖原脚本。
2. iPhone Safari 打开一次 HJD2048，等按钮不再显示“读取队列”；此时私有密钥会迁移到原脚本的 GM 存储，并核对写入结果。
3. 展开“磁链发送队列”，点击“脚本更新”，在打开的 `.user.js` 页面用 Userscripts 扩展选择覆盖；或者在 Userscripts 中选择“检查更新”，升级到 v4.1.1。
4. 升级后确认旧队列仍存在，已发送/待发送数量没有异常，再验证 Ping 接口。不要为升级删除旧脚本。

日后版本升级只需从脚本中打开固定的“脚本更新”链接或在 Userscripts 中检查更新，无需复制完整 JS。Userscripts iOS 自动检测更新的行为随扩展版本不同，不能保证后台静默更新。

## 安全和数据边界

- 公网版本的 `INGEST_SHARED_SECRET` 是空字符串；只从已经迁移的本地 GM 存储读取。未迁移时拒绝发送，绝不把密钥放到 GitHub。
- 固定 `@name`、`@namespace` 和文件名，避免变更用户脚本身份导致队列与授权存储不可读。
- 当前本地活动队列仍保存在 Userscripts 存储（`GM` / 降级 `localStorage`）；**服务器 D1 主队列恢复尚未部署**。绝不能把“代码公开更新”误当作“已经将待发送列表异地备份”。
- 在服务器异地队列上线并验证前，不能删除 Userscripts 数据、删脚本后重装或切换存储目录。
- 公共仓库仅发布无密钥文件；私有迁移版只存 mcpoffice。发布前应运行 `npm test`，并使用 `buildPublicRelease` 去密钥生成公网版本。
