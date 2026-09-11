# 音色卡制作会话提示词

将下面整段作为新 Codex 会话的首条消息：

---

你负责为《红楼梦》AI 有声书制作“音色卡库”和试听音频。工作区是当前仓库；先完整阅读根目录 `AGENTS.md`、`README.md`、`docs/audio_architecture.md`，再检查 `research/character-cards/cards/` 下的全部人物卡。不要修改 `content/chapters/` 中的小说正文，也不要修改 Cloudflare Pages 构建流程。

## 目标

建立机器可读、可复用的角色音色卡，让章节标注和音频生成脚本只引用稳定的 `voiceCardId`。默认服务商为 Edge-TTS；通过项目现有的 TTS provider 调用，不要在新脚本中直接耦合底层 WebSocket 或某个厂商 SDK。每张实际音色卡生成一段短试听 MP3。

## 重要度评估与复用原则

1. 以人物卡正文字符数为主要重要度信号，同时参考人物是否在同一场景频繁对话、年龄、性别、身份、性格和叙事功能。先生成一张统计表，按字符数从高到低排序。
2. A 级：人物卡长度位于前 20%，或在第 81 回承担主要对话。原则上使用独立音色卡。
3. B 级：接下来的 30%。若同场人物容易混淆则使用独立音色；否则可以按“年龄 + 性别 + 气质”共享。
4. C 级：其余人物及无关紧要的临时配角。优先共享少量角色池，例如“年长女眷”“年轻丫鬟”“少年男仆”“中年男性”“婆子”“官差”。
5. 同一章节中直接对话的两个人不得共享同一张音色卡。旁白必须独立，不能与第 81 回主要人物共用。
6. 文件长度只是重要度信号，不得据此推断性格。音色选择必须由人物卡中的明确证据支持；证据不足时保持中性。

## 音色卡格式

在 `content/audio/voice-cards/` 创建 JSON 文件；一张实际声音一个文件。文件名和 `id` 只用小写英文、数字和连字符。结构如下：

```json
{
  "version": 1,
  "id": "jia-baoyu",
  "label": "贾宝玉",
  "tier": "A",
  "provider": "edge",
  "voice": "zh-CN-YunxiNeural",
  "prosody": {
    "rate": "+0%",
    "pitch": "+0Hz",
    "volume": "+0%"
  },
  "emotions": {
    "neutral": {},
    "warm": { "rate": "-3%", "pitch": "+1Hz" },
    "joy": { "rate": "+8%", "pitch": "+2Hz" },
    "sad": { "rate": "-12%", "pitch": "-3Hz" },
    "anger": { "rate": "+10%", "pitch": "+1Hz" },
    "fear": { "rate": "+5%", "pitch": "+3Hz" },
    "urgent": { "rate": "+14%", "pitch": "+1Hz" },
    "whisper": { "rate": "-10%", "pitch": "-2Hz", "volume": "-25%" },
    "solemn": { "rate": "-8%", "pitch": "-2Hz" }
  },
  "aliases": ["宝玉", "宝二爷", "怡红公子"],
  "sharedCharacters": [],
  "sourceCards": ["research/character-cards/cards/贾宝玉.md"],
  "rationale": "用一两句话记录选择依据，不写无证据的心理诊断。"
}
```

允许删掉不适合某角色的情感预设，或把幅度调得更克制；所有数值都必须符合 Edge-TTS provider 支持的格式。Edge 免费接口不提供真正的风格模型，`emotion` 在当前阶段表示音色卡中的 prosody 覆盖值，不能宣称是情感克隆。

创建 `content/audio/voice-cards/index.json`，格式如下：

```json
{
  "version": 1,
  "defaultNarrator": "narrator",
  "characters": {
    "旁白": "narrator",
    "贾宝玉": "jia-baoyu",
    "宝玉": "jia-baoyu",
    "宝二爷": "jia-baoyu"
  },
  "cards": {
    "jia-baoyu": "jia-baoyu.json",
    "narrator": "narrator.json"
  }
}
```

共享音色的配角仍应在 `characters` 中各自映射到同一个卡片 ID，并在该卡的 `sharedCharacters` 中列出。不要为同一个声音复制 JSON。

## 音色选择和试听

1. 通过 Edge-TTS 实时查询可用的 `zh-CN` 音色，不要凭记忆写不存在的 ShortName。
2. 为每张实际音色卡生成 `content/audio/.cache/voice-previews/<voiceCardId>.mp3`，试听文本 40–80 个汉字；文本可使用公版原著短句或中性测试句，不使用尚未核验的人物台词。
3. 所有试听统一输出 24 kHz / 48 kbps 单声道 MP3。
4. 验证文件非空、能被音频探测工具识别，并记录时长。不要仅以“命令退出码为 0”判定成功。
5. 若 Edge-TTS 网络失败，保留已经完成的卡片和试听文件，写明失败清单，允许下次断点继续；不得生成空文件占位。

## 产出

- `content/audio/voice-cards/*.json`
- `content/audio/voice-cards/index.json`
- `content/audio/.cache/voice-previews/*.mp3`
- `research/drafts/audio-voice-allocation.md`：人物卡长度、等级、实际音色卡、共享理由、试听状态表。

先覆盖第 81 回出现且会说话的人物，以及旁白；其余人物可以分批完成。每轮结束前运行 JSON 校验和相关项目测试，不要改动用户已有的研究文件。最终报告已完成卡片、共享组、缺失人物和试听失败项。

---
