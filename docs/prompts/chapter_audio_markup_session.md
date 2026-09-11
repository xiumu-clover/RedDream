# 第 81 回音频标注会话提示词

将下面整段作为新 Codex 会话的首条消息；应在音色卡会话至少完成第 81 回角色之后运行：

---

你负责把第 81 回小说正文制作成可供多角色 TTS 使用的音频脚本。先完整阅读根目录 `AGENTS.md`、`README.md`、`docs/audio_architecture.md`，再阅读：

- `content/chapters/guiyou/081-惜昵近公子做良媒 讳笞罚丫鬟结恶党.md`
- `content/audio/voice-cards/index.json`
- 第 81 回相关的 `research/character-cards/cards/*.md`

不要修改原始章节文件；它仍是网站唯一正文。将带音频信息的派生 Markdown 写到 `content/audio/chapters/081.audio.md`。不要修改 Cloudflare Pages 构建流程。

## 音频脚本格式

frontmatter：

```yaml
---
version: 1
chapter: 81
source: content/chapters/guiyou/081-惜昵近公子做良媒 讳笞罚丫鬟结恶党.md
sourceHash: <原始章节文件原始 UTF-8 字节（含 frontmatter）的 SHA-256>
defaultVoice: narrator
---
```

正文必须逐字保留原文件移除 frontmatter 后的内容和现有 `[T]`、`[zp]`、`[mp]`、`[zpsc]`、`[sc]`、`[fu]`、`[B]`、`[wz]`、`[img]` 标记，只额外加入下面的音频标记：

```text
[voice:jia-baoyu|sad]这里是由贾宝玉朗读的直接引语[-]
```

标记中的 ID 不得含空格，例如：

```text
宝玉含泪道：[voice:jia-baoyu|sad]“二姐姐此去，好生保重。”[-]
```

语法为 `[voice:<voiceCardId>|<emotion>]...[-]`。`emotion` 只允许：

```text
neutral warm joy sad anger fear urgent whisper solemn
```

未包裹的可朗读内容使用 `defaultVoice` 作为旁白。人物直接说出的话、梦中说话、齐声说话可以加 voice 标记；“某某道”“说罢”“众人笑”等叙述仍由旁白读。诗词默认由旁白朗读，只有剧情明确由人物吟诵时才使用该人物音色。

## 标注规则

1. 绝不能修改、润色、删减或纠正原文。除新增 `[voice:...]` 与对应 `[-]` 外，原字符序列必须保持一致。
2. 不给 `[zp]`、`[mp]`、`[zpsc]`、`[wz]`、`[img]` 内部添加音色标记，因为这些内容不会进入朗读。
3. `[sc]`、`[fu]` 会朗读，可以在它们内部嵌套 voice 标记，但只有说话者明确时才这样做。
4. 根据上下文判断说话者；不确定时用旁白，不猜测。连续引语中说话者明确时可以连续使用同一音色卡。
5. 情感选择要克制，以句中明确动作、语气词和上下文为证据；一般叙述用 `neutral`，不要把整段都标成强烈情绪。
6. 每个 `voiceCardId` 必须存在于 `content/audio/voice-cards/index.json` 的 `cards` 中。
7. 如果人物没有卡片，先用 `narrator` 保证脚本可生成，同时把人物、出现位置、建议等级写入 `research/drafts/audio-081-missing-voices.md`；不要擅自创建未经试听的正式卡片。
8. 同一句不得嵌套两个 voice 标记。voice 标记必须正确闭合，并可跨越标点但不要跨越说话者切换。

## 验证

编写或使用校验脚本证明：

- 去除新增 voice 标记后，正文与原始章节逐字一致。
- `sourceHash` 与原始文件一致。
- 所有 voice 标记均闭合，emotion 在白名单内。
- 所有 voiceCardId 存在；缺失项全部进入报告。
- 原有章节标记仍能由网站编译器正确解析。

最后输出：标注段数、各音色卡使用次数、各情感使用次数、缺失音色卡和所有验证结果。不要直接生成整回 MP3；本会话只负责高质量音频脚本和缺失报告。完成后，项目根目录的 `generate_audio.bat` 会自动发现 `081.audio.md`，验证原文/哈希/卡片后按多音色生成，无需改 BAT。

---
