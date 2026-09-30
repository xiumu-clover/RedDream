# 私有云对白评审

这是独立于公开阅读网站的 Cloudflare Pages 应用。它只提供手机评审页面和审核 API，不生成音频、不写 `public/audio`，也不修改正式网站的音频 manifest。

## Cloudflare 资源

建议使用单独的 Pages 项目 `honglou-audio-review`，将同一 Git 仓库的项目根目录设为：

```text
scripts/audio/cloud-review
```

构建命令留空，输出目录设为 `public`。Pages Functions 位于 `functions/`，无需前端构建。

创建以下私有资源并绑定到生产和预览环境：

| 类型 | 绑定名 | 用途 |
| --- | --- | --- |
| D1 | `REVIEW_DB` | 审核批次与决定历史 |
| R2 | `REVIEW_AUDIO` | 以文件哈希命名的待审音频 |

在 D1 控制台执行 `schema.sql`。R2 Bucket 不允许公开访问；音频只能经过已认证的 `/api/review/audio/*` 接口读取。

配置以下 Pages Secret：

| 名称 | 类型 | 内容 |
| --- | --- | --- |
| `REVIEW_SYNC_TOKEN` | 加密 Secret | 独立生成的长随机同步令牌 |
| `REVIEWER_TOKEN` | 加密 Secret | 手机评审链接使用的独立长随机令牌 |

手机使用 `https://<project>.pages.dev/#key=<REVIEWER_TOKEN>` 打开。`#` 后的密钥不会随 HTTP 请求或 Referer 发送；前端只把它放入评审 API 的 `Authorization` 请求头，并在本机浏览器保存。页面静态外壳可以公开读取，但正文、进度、决定和音频接口没有正确令牌时一律拒绝。同步接口使用另一枚 `REVIEW_SYNC_TOKEN`，评审链接不能上传批次或导出决定。

如账户已经启用 Cloudflare Zero Trust，也可以不配置 `REVIEWER_TOKEN`，改为设置 `ACCESS_TEAM_DOMAIN` 和 `ACCESS_AUD`；服务端仍会验证 Access JWT 的签名、签发者、Audience 和有效期。两种方式不得共用同一令牌。

## 本地同步配置

把 `config.example.json` 的字段填写后保存到以下 Git 忽略路径：

```text
content/audio/.cache/cloud-review/config.json
```

也可以使用环境变量覆盖：

```text
CLOUD_REVIEW_URL
CLOUDFLARE_ACCESS_CLIENT_ID
CLOUDFLARE_ACCESS_CLIENT_SECRET
CLOUD_REVIEW_SYNC_TOKEN
```

上传第81回当前场景：

```sh
npm run audio:review:push
```

同步手机端决定：

```sh
npm run audio:review:pull
```

上传命令先重新同步本地计划，仅上传 `pending_review` 且已通过技术检查的当前文件。相同 `fileHash` 的对象会复用。拉取命令只接受与本地 `planHash` 完全一致的批次；“通过”写为 `approved`，“重录”写为 `rejected`，自然语言意见先标记为 `other` 交总控分派。

## 手机操作

1. 打开总控提供的完整加密评审链接。
2. 播放当前片段。
3. 点击“通过”，或点击“重录”并填写一句意见。
4. 页面自动进入下一条。

页面不要求选择问题类型，也不显示音色哈希、机器检查或工作单路由。
