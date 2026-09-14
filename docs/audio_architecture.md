# 第 81–108 回 AI 有声书架构

## 1. 范围与发布原则

本阶段只处理第 81–108 回。音频在本地预合成，网站只播放静态 MP3，不在浏览器请求期间调用 TTS，也不需要后端或服务密钥。

- 默认 TTS provider 为 Edge-TTS；provider 契约允许以后接入 Azure 或阿里云。
- 第 81 回是 Cloudflare Pages 试点，可发布女、男两条旁白音轨。
- 第 82–108 回可以在本地生成与试听，但不在发布白名单中。
- 第 1–80 回不生成音频，也不会显示播放器。
- 生成与发布分开；`generate_audio.bat` 永远不会写入 `public/audio/`。
- 当前不依赖 R2，也不修改现有 Cloudflare Pages 构建或定时构建流程。

仓库目前没有根目录 `SPEC.md`。正文标记行为以 `src/lib/chapters/compiler.ts` 及其测试为准。

## 2. 完整链路

```mermaid
flowchart TD
    A[content/chapters/guiyou/081-*.md] --> B[清理 frontmatter 与兼容标记]
    B --> C[compileChapter 生成章节 AST]
    C --> D[过滤批注、尾注、图片]
    D --> E[按段落、中文双引号、sc/fu 分块]
    E --> F[与已提交 map 或 pending map 匹配]
    F --> G[稳定 blockId + textHash + contextHash]
    G --> H{标注是否齐全且仍有效}
    H -->|否| I[写 081.request.md 和 pending map]
    I --> J[人工将 AI 结果合并到 annotations/081.json]
    J --> A
    H -->|是| K[计算 annotationHash 与 renderHash]
    K --> L{缓存片段完整且 hash 一致}
    L -->|是| M[复用片段]
    L -->|否| N[统一 TTS provider 合成片段]
    N --> O[逐帧校验 MP3 并计算 fileHash]
    M --> P[按 map 顺序机械拼接]
    O --> P
    P --> Q[本地男女整轨 .cache/tracks]
    Q --> R[publish_audio.bat 只读检查]
    R --> S{81 回、每轨小于 25 MiB、用户确认}
    S -->|是| T[原子复制到 public/audio]
    T --> U[原子更新 manifest.json]
    U --> V[Astro / Pages 静态部署]
    V --> W[章节页按 manifest 的 url 播放]
```

### AST 分块与过滤

| 来源 | 语音块分类 | 处理 |
| --- | --- | --- |
| `[T]` 标题 | `narration` | 去标记，保留标题文字 |
| 普通段落 | `narration` | 每个源段落建立基础块 |
| 外层中文引号 `“……”` | `dialogue` | 去掉外层引号，与同段旁白分开 |
| `[sc]`、`[fu]` | `poetry` | 去标记，保留诗词正文和内部换行 |
| `[B]` 等视觉标记 | 继承所在块 | 去标记，保留内部正文 |
| `[zp]`、`[mp]`、`[zpsc]` | 不生成 | 连内容一起丢弃 |
| `[wz]` / `[wz数字]`、`[img]` | 不生成 | 尾注、图片及图注不朗读 |
| 遗留 `【……】` 夹批 | 不生成 | 作为兼容规则连内容删除 |

分块器严格检查中文外层双引号；单段中存在未配对或错误嵌套时会在联网前停止，避免旁白与人物串音。

## 3. 稳定身份与增量更新

每个块有永久 ID，例如 `081-b0042`。ID 不包含文字 hash，因此在段落前插入新内容或小幅修改原文时，已有块仍能保留身份；完全相同的重复短句不会被错误合并为同一个块。

| 字段 | 含义 | 变化后的效果 |
| --- | --- | --- |
| `blockId` | 块的永久身份 | 尽量保持不变 |
| `textHash` | 实际朗读文字 SHA-256 | 正文变化时改变 |
| `contextHash` | 相邻块类型与文字 hash | 对话前后文变化时改变 |
| `annotationHash` | 会影响声音的语义标注 hash | 情感、说话人、韵律等变化时改变 |
| `renderHash` | 文字、标注、音色卡、provider 参数的合成键 | 只有声音结果可能变化时改变 |
| `fileHash` | 已生成 MP3 的实际 SHA-256 | 检测缓存损坏或错配 |

对旧块与新块先做顺序匹配，再做唯一精确匹配和保守的模糊身份匹配。标注继承规则为：

- 旁白文字变化率 `< 30%`：可自动继承旧标注。
- 对话文字变化率 `< 10%`，且上下文和关键语气标点没有风险：可自动继承。
- 诗词只要文字变化：必须重新标注。
- 新块、超阈值变化、对话上下文变化或缺少标注：写入 AI 请求并停止。
- 停止时保留已公开音频和已提交 map，不调用 TTS。

`contentHash` 在本实现中对应 `textHash`；另记录 `sourceSpeechHash` 表示整回有序朗读文本的 hash。

## 4. 标注文件

标注存放在：

```text
content/audio/annotations/081.json
```

结构示例：

```json
{
  "version": 1,
  "chapter": "081",
  "annotations": {
    "081-b0042": {
      "textHash": "<hash>",
      "contextHash": "<hash>",
      "speakerRef": "jia-baoyu",
      "emotion": {
        "family": "anger",
        "variant": "sullen-anger",
        "intensity": 2
      },
      "pace": "urgent",
      "pitch": "medium",
      "energy": "heavy",
      "timbre": ["firm"],
      "modifiers": [],
      "reviewStatus": "ai-reviewed",
      "confidence": 0.9,
      "note": "愠怒而克制"
    }
  },
  "annotationSetHash": "<所有标注的稳定 hash>"
}
```

`speakerRef` 为 `$narrator` 时，女轨使用 `zh-CN-XiaoxiaoNeural`，男轨使用 `narrator` 音色卡。人物对话引用 `content/audio/voice-cards/` 中的卡片，所以相同人物片段可在男女整轨间共享缓存。

情绪、语速、音高、力度、音质与“哭腔、冷笑、梦中呓语”等修饰会进入 `annotationHash`。Edge-TTS 对其中一部分只能用 rate、pitch、volume 近似表达；语义仍完整保存，供以后更强的 provider 使用。

## 5. TTS 抽象层

生成器只调用统一契约：

```js
const provider = await createTtsProvider(providerName, options);
await provider.synthesizeToFile({
  segments: [{ text, voice, rate, pitch, volume }],
  outputPath,
  onProgress,
});
```

主要文件：

```text
scripts/audio/generate_audio.js       分块、标注门禁、缓存与整轨编排
scripts/audio/render-plan.js          标注 + 音色卡 -> provider 参数与 renderHash
scripts/audio/track.js                MP3 校验、片段缓存和整轨拼接
scripts/audio/tts/provider.js         provider 工厂与统一入口
scripts/audio/tts/providers/edge.js   Edge-TTS 适配器
scripts/audio/tts/edge-client.js      Edge WebSocket 客户端
```

接入 Azure 或阿里云只需新增 provider 适配器、在工厂注册，并通过 `TTS_PROVIDER` 选择。分块、标注、map、缓存、BAT 和播放器都不需要改变。云服务凭据只能从环境变量读取。

## 6. 本地文件与缓存

```text
content/audio/config.json                 回目范围、双旁白和发布白名单
content/audio/annotations/081.json        可提交的语义标注
content/audio/maps/081.json               可提交的稳定顺序、hash 与输出记录
content/audio/.cache/pending/081.json      标注完成前的稳定 ID 草稿
content/audio/.cache/fragments/...         按 renderHash 寻址的 MP3 片段
content/audio/.cache/tracks/081/...        男女完整音轨
research/drafts/audio-annotations/081.request.md
```

整个 `content/audio/.cache/` 已加入 `.gitignore`。它是可重建的本机缓存，不提交 Git。`research/` 是独立私有仓库；生成标注任务前必须先将它克隆到项目根目录，避免任务文件落入未备份目录。标注和正式 map 应提交，以便正文不变时实现零次 Edge 调用。

整轨使用片段的有序 `renderHash` 列表计算 `trackHash`。只改一个块时，只合成该块的新片段，再用其余缓存片段机械拼接两条完整音轨。

## 7. Pages 发布与 manifest

第一阶段只允许第 81 回。发布目录只保留 manifest 实际引用的文件；当前试播清单仅含女声，男声通过发布检查后才会加入：

```text
public/audio/081.mp3         女旁白，默认
public/audio/081-male.mp3    男旁白
public/audio/manifest.json
```

`publish_audio.bat` 先执行只读检查，显示每轨大小、时长和 hash。任一文件损坏、与 map 不符或达到/超过 25 MiB 时禁止发布。确认后，两个 MP3 与清单以带回滚的原子替换方式安装。

清单格式：

```json
{
  "version": 2,
  "chapters": {
    "081": {
      "defaultVariant": "female",
      "variants": {
        "female": {
          "url": "/audio/081.mp3",
          "trackHash": "<hash>"
        },
        "male": {
          "url": "/audio/081-male.mp3",
          "trackHash": "<hash>"
        }
      }
    }
  }
}
```

章节页只按 `entry.data.order` 查找 manifest，并读取所选 variant 的 `url`；没有清单记录的回目不渲染播放器。`preload="metadata"` 避免打开页面时下载整轨。红楼梦与癸酉本各自保存独立阅读设置，音频旁白选择也互不影响；初始默认均为女声。

## 8. 日常工作流

首次安装：

```sh
npm install
```

生成或更新：

1. 双击 `generate_audio.bat`，输入 `81` 或 `081`。
2. 若脚本输出 `research/drafts/audio-annotations/081.request.md`，把任务交给 AI，将结果合并到 `content/audio/annotations/081.json`。
3. 再次运行 BAT。它只合成 `renderHash` 变化或缓存缺失的片段，并在本地生成男女整轨。
4. 本地试听后双击 `publish_audio.bat`。
5. 查看只读检查结果，输入 `Y` 才会发布第 81 回。
6. 正常提交仓库，由既有 Pages 构建流程部署。

终端等价命令：

```sh
npm run audio:generate -- 81
npm run audio:publish -- 81 --check
npm run audio:publish -- 81 --yes
```

## 9. 将来迁移到 R2

本地生成器保持不变。新增 R2 发布器，把整轨上传到带 `trackHash` 的版本化对象路径，然后只把 manifest 中的 `url` 改成完整 CDN URL，例如：

```text
https://audio.example.com/guiyou/081/female/<trackHash>.mp3
https://audio.example.com/guiyou/081/male/<trackHash>.mp3
```

验证远端音频可播放后，再从 `public/audio/` 移除大型 MP3。播放器不判断 URL 来自 Pages 还是 R2，因此章节页面、阅读设置、标注文件、map 和正文都无需迁移。

## 10. 剧情录音的批量工作流

剧情录音与章节纯旁白分开编排。当前人物对白在本机 WSL 的 CosyVoice2 上推理；Edge-TTS 旁白仍是网络服务，不是本地模型。两者都不消耗 Codex 的语言模型 token；token 来自对话中的代码分析、大量 JSON/日志回传和人工编排。

为避免把这些成本带入批量生产，使用三阶段命令：

```sh
# 1. 只对齐、路由和盘点缓存；不启动 TTS / CosyVoice / Whisper
npm run audio:scene:plan -- --chapter 081 --scene xiren-three-opera

# 2. 生成本地草稿并做音频完整性/电平检查；跳过 Whisper
npm run audio:scene:draft -- --chapter 081 --scene xiren-three-opera

# 3. 定稿验收；只对新增或改变的片段运行 Whisper
npm run audio:scene -- --chapter 081 --scene xiren-three-opera
```

默认控制台只输出数量、命中率和耗时摘要。需要排障时才设置 `AUDIO_VERBOSE=1`，避免每句模型日志进入 AI 上下文。

剧情缓存分为五层：

| 层 | 键 | 什么变化才失效 |
| --- | --- | --- |
| 原始合成 | `synthesisHash` | 合成文字、读音覆盖、音色卡/哈希、模型、速度或推理参数 |
| 音色后处理 | `renderHash` | 原始合成或片段后处理参数 |
| 短片段电平 | `sourceHash + level policy` | 输入 WAV 或 RMS/峰值政策 |
| ASR 转写 | `fileHash + Whisper model/settings` | 入片音频、模型或转写参数 |
| 验收判定 | `transcriptionHash + expectedText + rule version` | 期望文字或漏字/乱序/重复判定规则；不重新运行 Whisper |

CosyVoice Python 进程在同一批作业中只加载一次模型，并且按“音色卡 WAV + 准确文本”缓存 prompt speech token、声学特征和说话人嵌入。同一张卡的几十句对白不应重复解析参考音频。对跨多场景的大批量生产，下一步应再将多个场景的 missing jobs 合并成一份作业清单，让一个常驻进程连续处理，避免每个场景重新加载模型。

短旁白不再只依赖 LUFS 门限。小于数秒的音频可能被 LUFS gating 视为无效，所以每个入片 WAV 先检查 PCM RMS、峰值和有效样本比，再做短片段电平校准；最后整场才使用保守的 LUFS 处理。疑似空音频、超大增益、峰值越限或文字结构检查失败时必须停止拼接，不得把错误带入整场。

当前硬件与 CosyVoice2 组合中，`inference_instruct2` 曾连续超过单句两分钟而无输出，因此正式入片仍按既定安全策略回退到 `inference_zero_shot`。情绪主要来自日常、着急、伤心等多风格音色卡、自然分句、标点、速度和保守后处理，不能宣称已经实现精确指令情绪控制。批量提升质量的优先级是：先扩充主角多风格卡并做可追溯目录，再只为 ASR/结构检查失败的句子生成少量候选，最后实现跨场景 missing-job 聚合或常驻 CosyVoice worker，避免每场重复约十几秒的模型加载。
