# 人物声音卡说明

本文档说明《红楼梦》本地剧情录音所用的声音卡、情绪分型和验收状态。声音卡可以按“角色 × 情绪”保存多份；同一角色不再只有一个万能音色卡。

## 使用边界

- 影视原声只用来制作本地 AI 合成试听，不代表人物或演员本人说过合成文案。
- `content/audio/.cache/` 和 `content/audio.cache/` 都是 Git 忽略的本地缓存，不得复制到 `public/audio/`，未经试听确认也不得进入网站 manifest。
- `content/audio/voice-cards/*.json` 目前主要是旧 Edge 配置。人物对白使用 CosyVoice 时，不得读取其中的 Edge voice 代替下表的 WAV。
- `source-reference.wav` 是经保守清理的影视原声；`voice-card.wav` 是由原声生成的标准卡；`demo.wav` 必须再以标准卡为提示生成，用于检查二次克隆漂移。
- 新卡默认状态为“待人工试听”。FFprobe、Whisper 或 CAMPPlus 都不能代替人工判断角色相似度、情绪自然度和底噪。
- 所有合成文案均为 AI 测试文案，不是演员原话。

## 路由原则

1. 先根据 annotation 的 `speakerRef` 确定角色，再根据 `emotion.family`、`variant`、`intensity`、`pace`、`pitch`、`energy`、`timbre` 和 `modifiers` 选择情绪卡。
2. 只有“已试听可用”的情绪卡才能自动路由；否则回退到该角色的日常卡，并在场景 manifest 中记录回退。
3. 具体的 style ID、声音卡 WAV 哈希、准确提示文本和生成参数必须进入 `renderHash`。只写角色 ID 不足以复现音频。
4. 日常卡适合平静、温和和普通叙事，不应用于急吵、厉声质问或强烈悲恸。
5. 同一长对白可按语义分句使用同一情绪卡；除非标注明确发生情绪转折，不在一句中频繁换卡。
6. “三官同诉”或“齐声附和”默认使用 annotation 指定的单一代表声，不再叠加三张卡。普通对白仍分别使用艾官、荳官、葵官自己的卡。

第 81 回 `xiren-three-opera` 有一项已试听的场景级覆盖：宝玉全场统一使用 `restrained-sadness-v2`（听感定位锚点是“有什么话咱且轻轻说”那个已合成片段），不再在三张宝玉卡之间切换。这只影响该场景，不改写下表的通用候选规则。

建议的首轮映射如下；在人工试听前只作为候选规则：

| 角色 | annotation 倾向 | 候选 style |
| --- | --- | --- |
| 宝玉 | neutral、warm、低强度 affection | `daily` |
| 宝玉 | anger、indignation、urgent、质问 | `anxious-indignant` |
| 宝玉 | sadness、compassion、低至中强度哀伤 | `restrained-sadness` |
| 宝玉 | grieving、shock、强烈失落 | `grieving-shock` |
| 袭人 | neutral、warm、平静劝说 | `daily` |
| 袭人 | defensive-indignation、rivalry、争辩或压怒 | `assertive-rivalry` |
| 邢夫人 | neutral、calm、克制商议、主母问话 | `restrained-persuasion` |

## 宝玉

本批第 28、29 集原声文件分别为 `F:\网盘\下载\红楼梦28.mpg` 和 `F:\网盘\下载\红楼梦29.mpg`；每张卡下的 `contact-sheet.jpg` 保存了说话人和上下文证据。

### `daily`：日常、从容

- 标准卡：`content/audio.cache/voice-cards/baoyu/baoyu-voice-card.wav`
- WAV SHA-256：`e74dfcf3e088718036668b95fe921ed98c7eb32bd3a350975af19df4ba3f4877`
- 标准卡文本：“好姐姐，你且听我慢慢说，千万别恼。”
- 原声：第 20 集 `00:08:36.440–00:08:43.500`
- 原声文本：“药气比一切的花香果香都雅，神仙和高人逸士都去采药烧药。”
- 使用建议：平静交谈、温和解释、日常亲昵。
- 禁用：激烈争吵、急迫阻止、强烈悲痛。用户已指出这张卡用于第 81 回争吵时过慢。
- 状态：保留为日常卡；不作为争吵卡。

### `anxious-indignant-v1`：焦急质问、受压后的愤懑

- 标准卡：`content/audio/.cache/voice-cards/multistyle/jia-baoyu/anxious-indignant-v1/voice-card-delivery.wav`
- 试听：`content/audio/.cache/voice-cards/multistyle/jia-baoyu/anxious-indignant-v1/demo-delivery.mp3`
- delivery WAV SHA-256：`af739759ae1323b3aef483af93b308df8473ddd403d0ac823dfcf58c65d071ee`
- 原始生成 WAV SHA-256：`73070d11c7561c4ecbf00c5eeecc581af7924322749e6aedcfcfe9fdae7bec24`
- 原声：第 28 集 `00:47:54.820–00:48:00.970`
- 原声文本：“请问，到底犯了什么滔天大罪呀？就因为她生得太好了。”
- 标准卡文本：“这究竟是为什么？她到底犯了什么错，你们总该把话说明白呀！”
- 生成：CosyVoice2，speed `1.05`，FP16，JIT，speech tokenizer 在 CPU，`max-token-text-ratio=12`。
- Whisper：内容与顺序完整；“她/他、撵/念”等为同音识别差异，未检出漏句、重复或拖尾。
- CAMPPlus：原声→卡 `0.692831`；卡→试听 `0.901027`；原声→试听 `0.634472`。
- 使用建议：焦急追问、压不住的愤懑、阻止不公行为；不等同于失控咆哮。
- 状态：待人工试听。卡自身二次克隆稳定，但与强情绪原声的嵌入差异较大。

### `restrained-sadness-v2`：克制伤心、忧虑怜惜

- 标准卡：`content/audio/.cache/voice-cards/multistyle/jia-baoyu/restrained-sadness-v2/voice-card-delivery.wav`
- 试听：`content/audio/.cache/voice-cards/multistyle/jia-baoyu/restrained-sadness-v2/demo-delivery.mp3`
- delivery WAV SHA-256：`12068181251f86f42d6a600572b72084529e0b044e434fe8e174073ff8bf1273`
- 原始生成 WAV SHA-256：`892c66608f74ce89445029489599e27b9ade296879f72bab1679fc26d1e58a74`
- 原声：第 28 集 `00:49:51.000–00:49:57.050`
- 原声文本：“你也不用虚宽我的心。她从小在这里娇生惯养，没受过一点委屈。”
- 标准卡文本：“她受了这么多委屈，我心里实在放不下。”
- 生成：CosyVoice2，speed `1.00`，其余参数同上。
- Whisper：标准卡内容完整；试听中的“可一想/可以想”按同音分词差异记录。
- CAMPPlus：原声→卡 `0.802073`；卡→试听 `0.888012`；原声→试听 `0.664206`。
- 使用建议：担忧、怜惜、含泪但仍能说清楚的伤心。
- 状态：用户已指定为第 81 回争吵场景的宝玉统一卡；通用场景仍需单独验收。

### `grieving-shock-v2`：骤然得知死讯、强烈悲恸

- 标准卡：`content/audio/.cache/voice-cards/multistyle/jia-baoyu/grieving-shock-v2/voice-card-delivery.wav`
- 试听：`content/audio/.cache/voice-cards/multistyle/jia-baoyu/grieving-shock-v2/demo-delivery.mp3`
- delivery WAV SHA-256：`20634460dac92579e0a8d6a390fc6e3e7ef3d143a6dfc4de67aa19101571ba7b`
- 原始生成 WAV SHA-256：`2a72cd8c7d293d2fd0315c2b647c4cfe0be3dbc3186d15f5aa9c85ec378201d4`
- 原声：第 29 集 `00:16:10.650–00:16:15.300`
- 原声文本：“她真的死了？我知道，她死了，她死了。”
- 标准卡文本：“她当真已经去了？我再也见不到她了。”
- 生成：CosyVoice2，speed `1.02`，其余参数同上。
- Whisper：标准卡语序完整；v2 试听保留完整主干，未检出重复或拖尾。
- CAMPPlus：原声→卡 `0.693636`；卡→试听 `0.842232`；原声→试听 `0.499506`。
- 使用建议：震惊、失声后的悲恸。不要拿来表达普通失落。
- 状态：必须人工试听后决定；强烈情绪下声纹漂移明显，不宜仅凭文本通过。

### 宝玉保留但不路由的试验

- `gentle-caring-v1`：标准卡疑似把“去去就回来”说成“去去去回来”，拒绝。
- `gentle-caring-v2`：Whisper 出现“姐姐/姐弟、照看/照顾”等含混，拒绝。
- `restrained-sadness-v1`：标准卡疑似漏“够、得”，由 v2 取代。
- `grieving-shock-v1`：二次试听含混，由 v2 取代。
- 上述目录和 generation 元数据保留作失败证据，不得自动选用。

## 袭人

### `daily`：日常稳妥

- 标准卡：`content/audio/.cache/cosyvoice-demo/xiren-voice-card.wav`
- WAV SHA-256：`3125b558619e4b8dcc1ca150e351f04ef50f70cffe3a49ff273dbccd4fbd513e`
- 标准卡文本：“我是袭人，做事一向稳妥。”
- 使用建议：平静说明、照料、普通劝说。
- 禁用：第 81 回的急吵、负气争辩。用户已指出这张卡在争吵场景中过慢。
- 状态：保留为日常卡；不作为争吵卡。

### `assertive-rivalry-v1`：争强不平、冷硬自辩

- 标准卡：`content/audio/.cache/voice-cards/multistyle/xiren/assertive-rivalry-v1/voice-card-delivery.wav`
- 试听：`content/audio/.cache/voice-cards/multistyle/xiren/assertive-rivalry-v1/demo-delivery.mp3`
- delivery WAV SHA-256：`d4dbae20826221da63235dee337b33ddf5f8adf1d63dc35fb1cd4fac441e76b0`
- 原始生成 WAV SHA-256：`057c8f22d1679a00739de3fa5d6f0a2bcd0955271ab4708bbc3952f180b0dd18`
- 原声：第 28 集 `00:50:40.150–00:50:45.350`
- 原片实际文本：“晴雯算个什么东西！她纵然好，也灭不过我的次序去。”
- 标准卡文本：“二爷，这件事须得分说明白，我绝不能由着她们胡闹。”
- 生成：CosyVoice2，speed `1.05`，FP16，JIT，speech tokenizer 在 CPU，`max-token-text-ratio=12`。
- Whisper：内容和顺序完整；“晴雯/秦文、纵然/总然、她/他”为识别差异。
- CAMPPlus：原声→卡 `0.770520`；卡→试听 `0.854847`；原声→试听 `0.667789`。
- 使用建议：受质疑后的自辩、争次序、羞恼而强硬；不要演成纯粹尖叫。
- 状态：用户已试听认可第 81 回争吵场景中的袭人声音；其他场景仍应按语境复听。

### 袭人保留但不路由的候选

- `urgent-reproach-v1/source-reference.wav`
- 原声：第 29 集 `00:16:06.700–00:16:10.700`
- 候选文本：“你看你，你就知道胡说乱闹，让别人听见什么意思？”
- 原声 WAV SHA-256：`abe6e2c321993137cc2adf1fe7187263318142981dd06e8da186037b1ed17c42`
- 状态：只保留原声候选。Whisper 未稳定识别句尾“意思”，人工确认逐字稿前不生成标准卡。

## 邢夫人

### `restrained-persuasion-v1`：克制商议、主母问话

- 标准卡：`content/audio/.cache/voice-cards/multistyle/lady-xing/restrained-persuasion-v1/voice-card.wav`
- 试听用标准卡：`content/audio/.cache/voice-cards/multistyle/lady-xing/restrained-persuasion-v1/voice-card-delivery.wav`
- 二次试听：`content/audio/.cache/voice-cards/multistyle/lady-xing/restrained-persuasion-v1/demo-delivery.mp3`
- 标准卡 WAV SHA-256：`48f27919ee471a8fc5f368f68497f5e6f088eaf9a98d65490c63cc8a2fa273b7`
- 试听用 WAV SHA-256：`39bc30a04dfa72b9e103bb04dde8f59b2a8feaf1675be6a83b910124f3325774`
- 原声：第 18 集 `00:03:34.800–00:03:39.320`
- 原声文本：“叫你来，有一件为难的事要和你商量。”
- 场景：邢夫人在内室与王熙凤商议贾赦欲纳鸳鸯之事；整集联系表、局部联系表和上下文均确认说话人。
- 标准卡文本：“事情既已说到这里，就该依着规矩，一件一件办明白。”
- 二次试听文本：“你先把缘故说清楚，若真有委屈，我自然替你作主。”
- 声源性质：角色原声，不是代理声源；两段合成文案均为 AI 测试文案，不是演员原话。
- 清理：16 kHz 单声道 PCM；70 Hz 高通、7600 Hz 低通、`afftdn=nr=3:nf=-55`、约 `-20 LUFS`、短淡入淡出；未做人声分离。
- Whisper：原声完整；标准卡“一件/一见”、试听“作主/做主”为同音或字形差异，未检出漏句、重复、乱序或拖尾。
- CAMPPlus：原声→卡 `0.820404`；卡→试听 `0.929901`；原声→试听 `0.772575`。
- 使用建议：克制商议、家务安排、带分寸的劝说和不高声的主母问话。
- 禁用：失控怒斥、哭喊、轻快玩笑；也不应据此覆盖今后截取到的强硬或冷厉状态卡。
- 已知问题：参考原声约 `4.49` 秒，位于推荐时长下沿；原始合成 WAV 真峰值接近 `0 dBFS`，已另存只衰减、不压缩动态的 delivery 版本供试听。
- 状态：待人工 A/B 试听，不自动路由。

## 艾官、荳官、葵官

三张卡均为代理声源，不是人物或对应演员本人的原声；此说明必须保留在试听报告中。

| 角色 | 标准卡 | WAV SHA-256 | 来源 | 状态 |
| --- | --- | --- | --- | --- |
| 艾官 | `content/audio.cache/voice-cards/ai-guan/ai-guan-voice-card.wav` | `e7352bcf4a9f9f15c50e54148c9bb248221b019a4d8b90feecacbe1aeed1952c` | 第 28 集侍书代理声源 | 用户已试听认可本次场景声音 |
| 荳官 | `content/audio.cache/voice-cards/dou-guan/dou-guan-voice-card.wav` | `f1335c63a76e657b9bac918268f1b699c1ea43d98b02df029d7cc1cb820131ec` | 第 22 集莲花儿代理声源 | 用户已试听认可本次场景声音 |
| 葵官 | `content/audio.cache/voice-cards/kui-guan/kui-guan-voice-card.wav` | `fb0989c8d0096eecc5ef8fe5325e6c3dee03f455876017d2057939fe05516131` | 第 22 集彩云代理声源 | 现有候选；继续保留单声路由 |

第 81 回艾官开头“好你个西洋花点子哈巴狗儿”在 annotation 中记为独立强制单元：速度 `1.16`，整句连贯、词内不停，不与后一句合并。

三官的标准卡准确文本分别为：

- 艾官：“你先听我说，我有几句话要一件一件讲明白。”
- 荳官：“好姐姐，你先别着急，听我慢慢把事情说明白。”
- 葵官：“姐姐慢些，我把前因后果仔细说给你听。”

## 本批清理与验证记录

- 原声清理：16 kHz、单声道、PCM s16le；`highpass=70`、`lowpass=7600`、`afftdn=nr=5:nf=-55`、`loudnorm=I=-20:TP=-2:LRA=7`，短淡入淡出；未做人声分离。
- 标准卡与二次试听：24 kHz、单声道 WAV；另编码 128 kbps MP3。
- 四张待试听卡另有只衰减 `2.7 dB` 的 `*-delivery` 版本；不压缩动态，不改语速。delivery 标准卡的综合响度/真峰值依次为：宝玉焦急 `-18.17 LUFS / -2.66 dBTP`、宝玉克制伤心 `-20.56 / -2.58`、宝玉悲恸 `-18.04 / -4.57`、袭人争辩 `-18.55 / -2.76`。
- 六段原声候选和全部合成 WAV/MP3 已通过 FFprobe 与 FFmpeg 完整解码。
- 本批八次两阶段试验的 CosyVoice 纯推理合计 `198.536` 秒；包含被保留的失败版本。
- 24 个 generation 元数据哈希交叉检查无不一致。
- 可供后续路由器读取的本地清单：`content/audio/.cache/voice-cards/multistyle/catalog.json`；当前所有新情绪卡仍标为 `awaiting-human-review`，不会自动启用。
- 详细结果：`content/audio/.cache/voice-cards/multistyle/source-whisper-validation.json`、`generated-whisper-validation.json`、`generated-whisper-validation-v2.json`、`campplus-validation.json`。

本文档只登记卡片，不修改正文、正式 annotations、场景 manifest 或发布目录。
