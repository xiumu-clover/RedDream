# 私有研究仓库

人物卡、脂批、续书对照、草稿和研究图片保存在独立的 GitHub 私有仓库 `xiumu-clover/RedDream-Research`。它在本机仍位于网站项目的 `research/` 目录，但拥有自己的 `.git`，不是网站仓库的子模块。

## 安装位置

在网站项目根目录运行：

```sh
git clone https://github.com/xiumu-clover/RedDream-Research.git research
```

最终结构应为：

```text
Code/.git/             网站仓库
Code/research/.git/    私有研究仓库
```

网站仓库整体忽略 `research/`。因此研究资料的新增、修改和提交不会触发 Cloudflare Pages；没有私有仓库时，网站的 `npm test` 与 `npm run build` 也必须正常通过。

## 日常提交

两个仓库分别提交：

```sh
git status
git -C research status
git -C research add -A
git -C research commit -m "更新研究资料"
git -C research push
```

章节 Markdown 的唯一正式来源是 `content/chapters/` 下的三个书册目录。研究稿可以引用它们，但不要在 `research/` 中维护章节副本。

当前研究资料使用普通 Git 保存。可重新生成的缓存和临时音频不提交；将来若加入体积较大的、不可再生的 CosyVoice 参考录音，再单独评估 Git LFS。
