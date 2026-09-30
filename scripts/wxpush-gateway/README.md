# 微信推送 Pages 网关

安卓网络无法访问 `workers.dev` 时，使用独立的 Cloudflare Pages 项目作为入口。`site/_worker.js` 仅把 `POST /wxsend` 经 Service binding 转发给同账号的 `wxpush-game` Worker，保留客户端原有的 JSON、Authorization 和回复内容。`GET /health` 用于测试设备是否能访问此域名。

已部署为 `https://wxpush-game-gateway.pages.dev/`。在同账号 Pages 项目的 Production 环境中，`WXPUSH_SERVICE` Service binding 指向 `wxpush-game`。发布新版本时，将 `site/` 内的 `_worker.js` 与 `index.html` 打包并通过 Direct Upload 上传。若新建或修改绑定，需要重新部署使其生效。这里不保存任何 Token 或微信密钥。

客户端只需把 URL 改为 `https://wxpush-game-gateway.pages.dev/wxsend`；其余请求体和请求头保持不变。安卓浏览器可以先打开 `https://wxpush-game-gateway.pages.dev/health`，预期返回 `{"ok":true,"service":"wxpush-gateway"}`。
