# 维护脚本

```text
scripts/
  audio/                   有声书正文清理、分段与 TTS provider
  chapters/                章节导入、拆分等一次性维护工具
  research/
    characters/            人物卡引用核验和上下文工具
    zhipi/                 脂批提取与分类管线
    paths.cjs              研究脚本共用的可移植路径配置
```

常用命令：

```sh
npm run audio:generate -- 81
npm run audio:publish -- 81 --check
npm run extract:zhipi
npm test
```

音频生成器只接受 `content/chapters/guiyou/` 中的第 81–108 回。它从章节 AST 建立稳定的旁白、对话和诗词块；缺少或过期标注时先写入私有研究仓库的 `research/drafts/audio-annotations/NNN.request.md` 并停止，标注齐全后只合成变化片段，最终男女整轨留在 `content/audio/.cache/tracks/`。

生成与发布互相独立。`publish_audio.bat` 会检查本地整轨、hash、时长和 Cloudflare Pages 25 MiB 单文件限制；第一阶段发布白名单只有第 81 回。详见 `docs/audio_architecture.md`。

脚本从项目根目录运行，禁止写死某台电脑的绝对路径。研究类命令要求 `research/` 私有仓库已经克隆；缺失时会给出明确提示。新增脚本时按用途放入现有子目录；只有出现新的独立领域时才增加一级分类。
