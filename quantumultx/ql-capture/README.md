# 通用青龙 Cookie 采集 / Quantumult X
远程 Rewrite: https://raw.githubusercontent.com/masakacj/QLScriptPublic/main/quantumultx/ql-capture/rewrite.conf

公开脚本只包含顺丰精确白名单和自建网关客户端。**没有接收站或青龙密钥**。
首次使用时，在 QX 本地复制 setup.js 并填写自己的 HTTPS 服务域名、CAPTURE_TOKEN；手动运行一次。不要将填入密钥的版本提交到公开 GitHub。
随后手动运行 arm.js，打开已登录的顺丰会员积分页。确认服务器回执后自动关闭采集，或手动运行 disarm.js。

本功能仅适用于本人账号和本人明确允许的域名。需要在 Quantumult X 中启用且信任针对目标域名的 MITM；小程序若未走 QX 或请求中没有完整 Cookie，则不会捕获。
其他平台只扩展明确审核过的 profiles 和请求匹配规则，不使用通配域名，不上传整个 Cookie。

服务端代码与 Docker 配置存放于私有家庭部署环境。必须先 DRY_RUN 测试，实机验证后才打开青龙环境变量写入。
