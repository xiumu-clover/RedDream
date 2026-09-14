# 红楼共读

一个使用 Astro 构建的章节阅读站。章节以 Markdown 文件保存，并在构建时由项目内的自定义编译器解析为正文、脂批、诗词、长赋和气泡注释。

## 工程结构

```text
content/chapters/          唯一的章节 Markdown 正文
  hongloumeng/             前言与第 1—80 回
  guiyou/                  第 81—108 回整理版
  guiyou-original/         第 81—108 回原稿版
content/audio/             音频标注、map、音色卡与本地缓存
public/images/chapters/    章节原图
public/audio/              manifest 实际引用的已发布音轨
src/components/            按 books、chapters、layout、settings 分类的页面组件
src/lib/                   按 books、chapters、preferences 分类的业务逻辑
src/pages/                 Astro 路由；书册目录使用 [book] 动态路由
src/styles/                全站阅读与打印样式
research/                  独立的私有研究仓库，不属于本仓库
scripts/                   按 audio、chapters、research 分类的维护脚本
tests/                     与源码领域对应的自动化测试
```

网站运行只依赖公开仓库中的 `content/`、`public/` 和 `src/`。`research/` 是原位嵌套的独立私有仓库，缺失时不影响测试或网站构建；安装方法见 `docs/research_workspace.md`。所有页面通过 `src/lib/chapters/collection.ts` 读取、编译、校验并排序章节，不要在页面里重复实现这一流程。

## 编辑章节

按书册在 `content/chapters/hongloumeng/`、`content/chapters/guiyou/` 或 `content/chapters/guiyou-original/` 中新增 `.md` 文件。frontmatter 可使用：

```yaml
---
order: 1
description: 章节简介
---
```

正文标记：

| 标记 | 用途 |
| --- | --- |
| `[T]标题` | 当前行标题；首个顶层标题也是章节名称 |
| `[zp]...[-]` | 原脂批 |
| `[mp]...[-]` | 书批，标记内部的单个回车会保留为换行；多行时每行段首自动空两字 |
| `[zpsc]...[-]` | 脂批中的诗词 |
| `[sc]...[-]` | 普通诗词 |
| `[fu]...[-]` | 长赋 |
| `[B]...[-]` | 加粗内容，可嵌套在正文、批语、诗词或尾注中 |
| `[wz]...[-]` | 在当前位置插入自动编号的气泡注释，并在章末生成尾注 |
| `[img]文件名` 换行 `可选图注[-]` | 插入独立图片，点击可在当前页面放大 |

所有容器标记可以嵌套，`[-]` 关闭最近打开的标记。`[wz]` 内可以使用批语、诗词和长赋等内容标记，但不能再嵌套 `[wz]` 或使用 `[T]`。`\[` 输出字面量 `[`，行尾反斜杠强制换行。语法错误会中止构建，并报告源文件及行列。

尾注直接写在需要编号的位置，例如 `正文[wz]这里是尾注内容[-]继续正文`。解释器会按照本文件中的出现顺序从 1 自动编号；插入、删除或移动尾注后，无须修改其他位置，正文上标、气泡和章末尾注会一起重新排序。

在批语、诗词、长赋或尾注等非正文内容中，以 `——` 开始的署名或出处会自动另起一行、靠右显示。若 `——` 后第一个非空字符是“第”（例如 `——第六十回`），破折号会保留；其他出处会隐藏开头的 `——`。普通正文中的破折号不会被改动。

章节页的“阅读设置”可以分别隐去原脂批、书批和气泡注释，选择会保存在当前浏览器中。气泡注释默认也会完整列在本章末尾。脂批与书批不会自动添加括号；如需使用 `【】` 区分，请直接写入 Markdown 源文件。

普通正文中的一次回车会直接开始新段落；连续空行不会生成额外的空白段落。若要在同一段内强制换行，请在行尾写 `\`。诗词与长赋仍会保留标记内的逐行换行。

章节图片统一放在 `public/images/chapters/`，源码第一行只写文件名，例如：

```text
[img]红楼批语对照.png
脂批版本对照[-]
```

图注可以省略：`[img]红楼批语对照.png[-]`。图片必须是顶层独立段落，不能嵌套在正文、批语、诗词、标题或尾注中；图注也不解析其他标记。支持 PNG、JPG、JPEG、WebP、GIF 和 AVIF，不支持 SVG。若文件名不合法、格式不支持或目录中找不到文件，构建会报告对应章节及行列。网页端点击图片可在当前页面放大，打印时会直接输出原图和可选图注。

“紧凑排版”会压缩字号、行距与留白；“不再翻页（所有回目）”会进入 `/chapters/all/`，按 `order` 把全部回目放进同一个网页。连续页打印时，每回会从新页开始，适合通过浏览器“打印 → 保存为 PDF”制作纸质书稿。

章节末尾会按照 `order` 顺序显示上一回、返回目录和下一回入口。

## 预览手机效果

在 Chrome 或 Edge 中打开章节页，按 `F12`，再按 `Ctrl+Shift+M` 打开设备工具栏，即可选择手机型号或直接输入页面宽度。

若要使用同一局域网中的真实手机预览，可重新以局域网模式启动：

```sh
npm run astro -- dev stop
npm run astro -- dev --background --host
```

随后让手机和电脑连接同一网络，使用启动日志中显示的 Network 地址访问。

## 命令

```sh
npm test
npm run build
npm run extract:zhipi
npm run astro -- dev --background
npm run astro -- dev status
npm run astro -- dev logs
npm run astro -- dev stop
```

## 每日自动构建

`.github/workflows/scheduled-build.yml` 每天北京时间 03:17 运行测试和 Astro 构建；验证通过后调用 Cloudflare Pages Deploy Hook，触发生产站重新构建。选择 03:17 是为了避开 GitHub Actions 每逢整点较容易出现的排队高峰，计划任务仍可能因平台负载稍有延迟。

首次启用时需要完成一次私密配置：

1. 在 Cloudflare 的 `Workers & Pages → reddream → Settings → Builds → Deploy hooks` 中，为 `main` 分支创建 Deploy Hook。
2. 在 GitHub 仓库 `Settings → Secrets and variables → Actions` 中新增 Repository secret，名称必须为 `CLOUDFLARE_PAGES_DEPLOY_HOOK`，值为刚才的完整 Hook URL。

Deploy Hook URL 相当于部署凭据，不得写入代码、文档或提交记录。普通 `main` 分支推送仍由 Cloudflare Git 集成自动部署；工作流只在定时运行或手动运行时调用 Hook，避免同一次推送重复部署。
