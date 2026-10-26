# 人物声音卡说明

本文档说明《红楼梦》本地剧情录音所用的声音卡、情绪分型和验收状态。声音卡可以按“角色 × 情绪”保存多份；同一角色不再只有一个万能音色卡。

## 2026-10-16 潘又安新代理声候选

用户未选原贾芸 `earnest-assistance-v1` 代理版，要求另给几个候选。本轮不重新扫描影视素材，而是复用三张现有可追溯青年男声卡，统一合成“我既回来了，自然要把前因后果说个明白。”。三版均为 AI 合成的代理选角试听，**不是潘又安或其演员的原声**。

| 候选 | 真实声源 | 时长 | Whisper | CAMPPlus 原声→卡 / 原声→Demo / 卡→Demo | 试听 MP3 SHA-256 |
| --- | --- | --- | --- | --- | --- |
| 一：`baoyu/daily` | 贾宝玉 | 5.376 s | “既/记”近音 | 0.785 / 0.692 / 0.935 | `c988e95ed966c1a3cbe9ec9f373bfce98da6e88195a6e976601afd0ad79e64d1` |
| 二：`jia-baoyu/gentle-caring-v2` | 贾宝玉（公共池卡） | 3.696 s | “既/记”近音 | 0.809 / 0.675 / 0.902 | `b6ddbae009deedbb2a71be5612d1899b3796944c93b2f4929268a8f2eae0e3e3` |
| 三：`jiang-yuhan/natural-explanation-v2` | 蒋玉菡 | 3.768 s | 逐字匹配 | 0.822 / 0.771 / 0.888 | `113e8dd461b480fcc2e6684296f51b6d3bf6c989e48606cf98bb13c0c78b6aa5` |

三版均为 24 kHz 单声道，已通过 FFprobe、FFmpeg `-xerror` 全段解码和 Whisper small 结构检查。详细响度、文本、源卡哈希与技术警告见本地忽略缓存 `content/audio/.cache/voice-cards/multistyle/pan-youan/candidates/candidate-set.json` 及各候选目录的 `proxy-assignment.json`。用户已于 2026-10-16 选择候选三 `jiang-yuhan/natural-explanation-v2` 用作潘又安代理声；批准绑定标准卡 WAV 与候选试听 MP3 的精确哈希。候选一、二保留为未选历史样本，不进入潘又安正式路由。

## 2026-10-03 蒋玉菡、花自芳交换音色卡

用户试听第 81 回第三小节后要求两人的卡片对换：蒋玉菡改用第 36 集贾芸原声制作的 `jia-yun/earnest-assistance-v1` 代理卡；花自芳改用 `jiang-yuhan/natural-explanation-v2` 作为代理卡。两人的原声身份没有随路由交换：前者不是蒋玉菡或其演员本人原声，后者也不是花自芳或其演员本人原声。实体 WAV 和生成元数据不移动、不改名；现行机读分配以 `cosyvoice-casting.json` 为准。

## 2026-10-02 第81回剩余角色代理候选

重新按现行 `081.json` 与 311 个缓存分块审计后，第81回共有 132 个对白块、24 个非旁白 `speakerRef`。原有已批准卡可覆盖其中19个；本轮为其余5个引用制作了兼容性 Demo，并因撞声检查额外给 `081-b0302` 的未具名丫头准备了第6张候选。所有底层标准卡均复用现有文件，没有复制声音；全部目标适配仍为 `candidate-awaiting-human-review`，未写入正式路由。

| 目标 | 复用标准卡 | Demo | Whisper | CAMPPlus 原声→卡 / 原声→Demo / 卡→Demo | 当前结论 |
| --- | --- | --- | --- | --- | --- |
| 年长女眷池（司棋母、封氏） | 贾母 `warm-praise-v2` | 5.260 s | 逐字匹配 | 0.670 / 0.560 / 0.821 | 用户通过；高漂移风险保留 |
| 王夫人丫头、莲花儿 | 莲花儿声源的 `dou-guan/proxy-cast` | 4.660 s | “顽/玩”同音 | 0.770 / 0.695 / 0.866 | 用户通过；不含 `081-b0302` |
| 未具名丫头 `081-b0302` | 春燕 `daily` | 5.480 s | 三处同音写法，机器标记复核 | 0.527 / 0.522 / 0.901 | 用户通过；标注拆分前仍阻断路由 |
| 潘又安 | 贾芸 `earnest-assistance-v1` | 4.680 s | 逐字匹配 | 0.746 / 0.637 / 0.898 | 未选；已另制三个候选 |
| 夏金桂 | 王熙凤 `practical-caution-v1` | 4.320 s | 逐字匹配 | 0.842 / 0.736 / 0.884 | 用户通过；代理身份保留 |
| 未具名来客 | 贾政 `studious-reflection-v1` | 6.280 s | 逐字匹配 | 0.775 / 0.690 / 0.879 | 身份未知，中性代理待审 |

`young-maids-pool` 原标注同时包含莲花儿和一名直接回答她的未具名丫头，不能继续共用同一声音。声音卡侧已经准备两张不同代理卡，但遵守职责边界没有改动正式语义标注；制作章节前必须由标注流程把 `081-b0302` 拆为独立 `speakerRef`。完整来源、逐字稿、哈希、响度和限制见各候选目录中的 `proxy-assignment.json`，最新本地审计见 `content/audio.cache/voice-cards/chapter-081-voice-audit.md`。

## 2026-10-02 宝玉 `gentle-caring-v2` 转入公共池

用户试听第 81 回第三小节后确认 `jia-baoyu/gentle-caring-v2` 不适合作为宝玉声线。该卡已从宝玉路由禁用，并在 `cosyvoice-casting.json` 中登记为 `public-pool-unassigned`。实体 WAV、生成元数据及贾宝玉原声来源事实保持原样，不物理移动或重命名；未来若分配给其他人物，必须重新制作上下文 Demo 并单独试听批准。第三小节宝玉对白统一改用用户认可的 `restrained-sadness-v2`。

## 2026-10-02 蒋玉菡本人原声卡、花自芳代理声已批准

- 蒋玉菡旧候选 `graceful-recitation-v1` 取自行酒令，用户试听后否决：吟诵语态导致日常说话不自然。历史文件保留但不路由。新版 `jiang-yuhan/natural-explanation-v2` 从第 12 集 `F:\网盘\下载\红楼梦12.mpg` 的 `00:30:49.200–00:30:55.780` 取本人在互赠汗巾时的自然说明：“这是茜香国女王进贡的物品，夏天系着，肌肤生香，不生汗渍。”标准卡文案：“二爷放心，我既答应了，自然不会草率。”二次 Demo：“该有的礼数一样不少，我会把事情办得周全。”标准卡 WAV SHA-256 `171f301580c98d531c08c3bc6425f0a5de35940a9312508ffc10159d600f5be7`；CAMPPlus 原声→卡 `0.822`、原声→Demo `0.711`、卡→Demo `0.881`。用户已于 2026-10-02 试听批准；技术漂移警告继续保留，尚未写入正式章节路由。
- 花自芳旧代理选用甄士隐 `warm-encouragement-v1`，用户试听后否决：甄士隐在第 81 回另有对白，且声线年龄偏大。历史代理记录保留但不路由。新版以第 36 集 `F:\网盘\下载\红楼梦36.mpg` 的 `00:17:45.200–00:17:52.080` 贾芸原声做代理：“原来你就是，早听红儿说过，多亏了你照应。”贾芸标准卡 `jia-yun/earnest-assistance-v1` 文案：“这件事我已经问清楚了，咱们坐下慢慢商量。”花自芳二次 Demo：“二爷果然不是哄我？若有这等好事，真是妹妹的造化。”标准卡 WAV SHA-256 `c116e7d54e87fbaee217ce7da8b60da7cf54888a256663850341d67f83f88a93`；CAMPPlus 原声→卡 `0.746`、原声→Demo `0.673`、卡→Demo `0.923`。用户已于 2026-10-02 试听批准用于花自芳；这仍明确是贾芸代理声，不是花自芳或其演员原声，且不等于批准为贾芸正式卡。

两套已批准版本的完整哈希、响度、来源和限制分别见本地忽略缓存 `multistyle/jiang-yuhan/natural-explanation-v2/generation.json` 与 `multistyle/hua-zifang/jia-yun-proxy-v2-demo/proxy-assignment.json`。现行可机读选角登记见 [cosyvoice-casting.json](cosyvoice-casting.json)。旧 Edge 卡、正式标注、章节正文和发布文件均未改动。

## 2026-09-29 王夫人重新取卡候选

从第 31 集 `F:\网盘\下载\红楼梦31.mpg` 的 `00:23:43.350–00:23:48.050` 另取王夫人独白，命名 `lady-wang/measured-consultation-v2`。画面联系表显示她与贾政谈宝玉读书时持续发言；第 31 集已严格全片解码。原声逐字稿：“求老爷再教导教导他，逼他收一收心。”原声、放慢核查版和清理版 Whisper 识出全句，清理版仅有“逼／避”同音差异；最终仍请用户听原片确认。

新卡标准文案：“老爷，这件事还请多费些心，咱们慢慢商量。”首选二次 Demo：“孩子们的事，我会再问清楚，然后同老爷商议。”两句均为 AI 合成测试文案，**不是演员或剧中王夫人的真实发言**。标准卡 `content/audio/.cache/voice-cards/multistyle/lady-wang/measured-consultation-v2/voice-card.wav`，SHA-256 `125bcf0ea4de42a96447b12d6872f08768cbd2944fd2cabdbcc8d6a1d047cb9b`；审听卡 `voice-card-delivery.mp3`，首选 Demo `demo-v2-delivery.mp3`。完整原声、清理参数、三轮试听与哈希见同目录 `generation.json`。

Whisper：标准卡逐字匹配；首个 Demo 的句首含混，第三个 Demo 声纹更远，均保留试验文件但不作为首选。CAMPPlus 原声→卡 `0.789`；原声→首选 Demo `0.625`、卡→首选 Demo `0.879`，仍有明显二次声纹漂移风险。审听版仅做衰减至约 −20 LUFS；canonical 卡及 Demo 的真峰值高于 `0 dBTP`。**新卡仅为待用户 A/B 的候选，旧王夫人卡保持原有批准与路由，不自动替换、不发布。**

## 2026-09-28 迎春、秋纹重新选角（最新）

- 迎春现与香菱共用 `xiangling/calm-poetry-talk-v1`；87 版香菱原声是**代理声源**，不是迎春原声。第 81 回两人不在同场直接对话。第 81 回第一节的 CosyVoice 参考卡选择已改为该卡；新迎春长句 Demo 见本地 `content/audio/.cache/voice-cards/multistyle/jia-yingchun/xiangling-shared-v1-demo/`，仍待用户听审这段新文案。
- 秋纹现改用原迎春的 `jia-yingchun/resigned-calm-v1`，其第 27 集迎春原声出处和准确参考文本仍按原 `generation.json` 保留，明确为秋纹的**代理声源**。未生成秋纹新 Demo，也没有覆盖原始卡。
- 原秋纹 `qiu-wen/soft-remembrance-v1` 不再是秋纹当前用卡；用户喜欢此声线，先作为“未来主要人物备用”保留，目标人物尚未指定。保留此前通过记录及所有技术风险，不移动、不改名。

当前 CosyVoice 选角的可机读表是 [cosyvoice-casting.json](cosyvoice-casting.json)。该表与旧 Edge-TTS `index.json` 分离，不修改网站旁白或发布音频。原声身份不随选角转移而改变。

## 2026-09-28 用户试听决定（以此节为准）

本地试听页的 40 套卡中，**37 套经用户听审通过**；宝玉 `restrained-sadness-v1` 有 1 项情绪标签待重定；贾政 `studious-reflection-v2` 与黛玉旧日常卡 2 项不采用。逐卡决定和试听 MP3 的 SHA-256 见 [REVIEW_DECISIONS.md](REVIEW_DECISIONS.md)；本地 `content/audio/.cache/voice-cards/review-decisions.json` 还绑定原声、标准卡和 Demo 的哈希。试听页 `content/audio/.cache/voice-cards/review-queue.html` 已按这次决定更新。

- 宝玉 `restrained-sadness-v1` **不能按“难过”风格使用**。用户听感是“心里有点生气”；只保留原文件，待另行确认新风格 ID，不覆盖或移动旧卡。`restrained-sadness-v2` 仍可用。
- 贾政使用 `studious-reflection-v1`；v2 保留历史文件但不选用。黛玉使用新取的 `quiet-rain-v2`；旧日常卡保留历史文件但不选用。
- 秋纹 `soft-remembrance-v1`、宝钗 `composed-counsel-v1`、鸳鸯 `attentive-service-v1` 与 `defiant-refusal-v2` 均在通过之列。鸳鸯日常版原声→标准卡/Demo 的 CAMPPlus 仍为 `0.583/0.422`，不得把用户认可表述成机器技术通过。

人工决定不抹除既有转写、响度和声纹警告。下文较早写成“待审”“失败试验”的段落记录的是当时的机器/制作判断；以本节和逐卡审核表为准，但没有因此自动改动正式路由、标注、manifest 或发布文件。

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
| 贾迎春 | 临别、克制退让 | 与香菱共享 `calm-poetry-talk-v1`（代理声；新 Demo 待审） |
| 秋纹 | 日常或低声回话 | 原迎春 `resigned-calm-v1`（代理声）；原秋纹卡留作主要角色备用 |

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
- `gentle-caring-v2`：用户确认不适合作为宝玉声线；宝玉路由禁用，转入公共候选池且暂不分配。Whisper 的“姐姐/姐弟、照看/照顾”等历史含混继续保留。
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

## 贾迎春

### `resigned-calm-v1`：克制退让、缓和争执

- 标准卡：`content/audio/.cache/voice-cards/multistyle/jia-yingchun/resigned-calm-v1/voice-card.wav`
- 二次试听：`content/audio/.cache/voice-cards/multistyle/jia-yingchun/resigned-calm-v1/demo-delivery.mp3`
- 标准卡 WAV SHA-256：`f97a78da9abb306a5958178eff3d22577250233180ef05886a6e3ce35fb65805`
- 原声：第 27 集 `00:35:18.300–00:35:24.600`，迎春在房内处理乳母儿媳与绣桔因累丝金凤引起的争执。
- 原声候选逐字稿：“我也不要那凤了，便是太太问时，我只是说丢了，也妨碍不着你什么的。”Whisper 与画面、剧情相符，近音字及最终听感待用户确认。
- 标准卡文本：“罢了，先别争了。事情总有个缘故，咱们慢慢说清楚。”
- 二次试听文本：“姐姐也别着急，等明日再问问，兴许还有别的办法。”
- 声源性质：87 版中迎春的角色原声；两段合成文案均为 AI 测试文案，不是演员原话。
- 清理：16 kHz 单声道 PCM；70 Hz 高通、7600 Hz 低通、轻度 `afftdn=nr=3:nf=-55`、约 `-20 LUFS`、短淡入淡出；未做人声分离。
- Whisper：标准卡“争/证”“缘/远”为近音识别差异；二次试听逐字匹配，未检出漏句、重复或乱序。
- CAMPPlus：原声→卡 `0.842326`；原声→试听 `0.717816`；卡→试听 `0.889093`。后两组略低于项目参考值，需重点试听声纹稳定性。
- 使用建议：日常缓和、克制退让、轻声劝止。禁用：哭喊、激烈怒斥、欢快戏谑。
- 状态：待用户 A/B 审核，不自动路由。完整哈希、时长和技术记录见同目录 `generation.json`。

## 平儿

### `discreet-explanation-v1`：私下解释（第 82 回待审候选）

- 标准卡：`content/audio/.cache/voice-cards/multistyle/ping-er/discreet-explanation-v1/voice-card.wav`
- 二次试听：`content/audio/.cache/voice-cards/multistyle/ping-er/discreet-explanation-v1/demo-delivery.mp3`
- 标准卡 WAV SHA-256：`19297943fba037df9fbd39c862c919a5ba15f8723c936dd6a8e1f99f5b1e731d`
- 原声：第 20 集 `00:10:10.650–00:10:16.800`，平儿私下向麝月说明虾须镯去向；连续近景口型、对话前后文与第 52 回对应场景确认身份。
- 参考文案暂校为：“我回二奶奶，就说那天镯子褪了口，丢在草根底下，雪深了没看见。”Whisper 对“镯/桌、褪/退、丢/堆、雪/血”有近音误写，仍需人工听原片逐字核准。
- 标准卡：“你先别急，我把来龙去脉一件一件说清楚。”二次试听：“奶奶放心，这事我记在心里，明早就去问明白。”均为 AI 合成测试文案，不是演员原话。
- 清理：16 kHz 单声道 PCM；70 Hz 高通、7600 Hz 低通、轻度 `afftdn=nr=3:nf=-55`、响度统一、短淡入淡出；没有做人声分离。
- Whisper：标准卡“说/书”、Demo“这事/这是”近音；未见漏句、重复或错序。CAMPPlus 原声→卡 `0.792118`、原声→Demo `0.681983`、卡→Demo `0.912426`；二次成声稳定，但相对原声可能漂移。
- 用途：私下解释、克制提醒、温和安慰；不适用于怒斥、尖叫或哭泣。状态：待人工 A/B 审核，不自动路由；完整哈希、格式、响度和耗时见同目录 `generation.json`。

## 王熙凤

### `practical-caution-v1`：审慎劝说（第 82 回待审候选）

- 标准卡：`content/audio/.cache/voice-cards/multistyle/wang-xifeng/practical-caution-v1/voice-card.wav`
- 二次试听：`content/audio/.cache/voice-cards/multistyle/wang-xifeng/practical-caution-v1/demo-delivery.mp3`
- 标准卡 WAV SHA-256：`44716779cd157e1b799fc84025b48f20ea5a7e8d2753ab3ee68a114ae155e66a`
- 原声：第 18 集 `00:03:46.550–00:03:50.850`，凤姐与邢夫人商议鸳鸯之事；逐秒联系表显示连续说话口型，并由第 46 回对应情节确认身份。
- 原声逐字稿：“依我说，竟别去碰这个钉子。”Whisper 的“以/依”同音写法由同场原著校正，待用户听审。
- 标准卡：“这件事先别声张，等问清楚了再作打算。”二次试听：“你先把话说完，我自会想个周全的法子。”两段均为 AI 合成测试文案，不是演员真实发言。
- 清理：16 kHz 单声道 PCM；70 Hz 高通、7600 Hz 低通、轻度 `afftdn=nr=3:nf=-55`、响度统一和短淡入淡出；没有做人声分离。4.28 秒参考处于推荐长度下沿。
- Whisper：标准卡“声张/生章、作/做”为同音写法差异；试听逐字匹配。CAMPPlus 原声→卡 `0.841778`、原声→试听 `0.716596`、卡→试听 `0.871966`，二次声纹低于参考线。
- 用途：审慎劝说、日常商议、机敏对答；**不适合第 82 回病中虚弱状态**，也不应当作怒斥卡。
- 状态：仅保留本地待审候选，暂不建议批准或进入正式路由。完整哈希、响度、时长与耗时见同目录 `generation.json`。

## 麝月

### `practical-light-v1`：取诊金时轻快务实（待审候选，不建议直接批准）

- 标准卡：`content/audio/.cache/voice-cards/multistyle/she-yue/practical-light-v1/voice-card.wav`
- 二次试听：`content/audio/.cache/voice-cards/multistyle/she-yue/practical-light-v1/demo-delivery.mp3`
- 标准卡 WAV SHA-256：`6a4bf98834d5060e572526ce1b99834b07fdc5fd8f6cdc3ff483c5d587a87dad`
- 原声：第 20 集 `00:08:11.220–00:08:16.650`，晴雯病中请医后，麝月替宝玉取诊金；整段、局部联系表、近景口型与第 51 回情节共同确认身份。
- 参考文本暂校为：“这有一两的，宁可多些别少了，叫那穷小子笑话咱们。”Whisper 将“宁可/多些/穷”听成“您可/多谢/丑”；这些字尚需用户对着原片人工确认，当前不能宣称逐字稿已通过。
- 标准卡文案：“你先别急，事情总能商量妥当，容我慢慢说明白。”二次试听：“我把屋里的东西理好了，等姐姐回来再告诉她。”两句均为 AI 合成测试文案，并非演员发言。
- 声源性质：87 版麝月角色原声，非代理；适合日常交代、务实办事，不适合哭泣、厉声质问或惊惧。
- 清理：16 kHz 单声道 PCM；70 Hz 高通、7600 Hz 低通、轻度 `afftdn=nr=3:nf=-55`、约 −20 LUFS、短淡入淡出，未做声源分离。
- Whisper：标准卡逐字匹配，Demo 的“理/离”为同音差异，均须人工试听。CAMPPlus 原声→卡 `0.853461`、原声→Demo `0.745890`、卡→Demo `0.836791`；后两组未达到参考线，二次声纹漂移风险明显。
- 状态：只保留本地候选，不建议直接批准，也不进入正式路由。完整哈希、格式、时长、响度和耗时见同目录 `generation.json`。

## 香菱

### `calm-poetry-talk-v1`：平静谈诗（待审候选）

- 标准卡：`content/audio/.cache/voice-cards/multistyle/xiangling/calm-poetry-talk-v1/voice-card.wav`
- 二次试听：`content/audio/.cache/voice-cards/multistyle/xiangling/calm-poetry-talk-v1/demo-delivery.mp3`
- 标准卡 WAV SHA-256：`1bb3ddfd1d67244cfd9942473e1c6dc0cdd72e94a4848a71b7d25cf3c88f2b4d`
- 原声：第 19 集 `00:21:37.720–00:21:44.220`，香菱向黛玉谈王维诗中的景物；额心胭脂痣、连续口型和第 48 回学诗情节确认身份。
- 原声准确文本：“只有几棵树，远远的几家人家正在做晚饭。”原声 Whisper 对“棵/颗”有同音字差异，结合语义校正。
- 标准卡文本：“姐姐若肯教我，我便用心学着，慢慢总会明白的。”
- 二次试听文本：“园子里的花开得正好，我想把这首诗再念给你听。”两句均为 AI 测试文案，不是演员原话。
- 声源性质：87 版香菱角色原声，非代理。适合请教、平静谈诗；不适合第 81 回病中、受惊或受辱的强情绪对白。
- 清理：16 kHz 单声道 PCM；70 Hz 高通、7600 Hz 低通、轻度 `afftdn=nr=3:nf=-55`、短淡入淡出；不做人声分离。
- Whisper：标准卡“教/敲、着/证”、试听“园/原、花/画”可能是同音识别或咬字问题，待用户逐字听审；无明显漏句、重复或乱序。
- CAMPPlus：原声→卡 `0.886938`，原声→试听 `0.784845`，卡→试听 `0.910089`；达到参考值，但不能取代人工 A/B。
- 状态：候选保留，不自动路由。完整文件哈希、时长、响度与耗时见同目录 `generation.json`。

## 紫鹃

### `gentle-reproach-v1`：轻声劝止（待审候选）

- 标准卡：`content/audio/.cache/voice-cards/multistyle/zi-juan/gentle-reproach-v1/voice-card.wav`
- 二次试听：`content/audio/.cache/voice-cards/multistyle/zi-juan/gentle-reproach-v1/demo-delivery.mp3`
- 标准卡 WAV SHA-256：`12170203bee36ad13ed289a24faa7ae573d995d907b93002c06d1c96901cb094`
- 原声：第 23 集 `00:03:26.020–00:03:30.240`，潇湘馆回廊紫鹃当面劝宝玉；整集联系表、局部口型、前后对话和第 57 回剧情确认身份。
- 原声准确文本：“以后咱们只可说话，别动手动脚的。”
- 标准卡文本：“先别胡闹，姑娘还在屋里歇着，咱们说话小声些。”
- 二次试听文本：“你若真心为她着想，就该把这件事问个明白。”两段合成文案均为 AI 测试文案，不是演员原话。
- 声源性质：87 版中紫鹃的角色原声，非代理。适合轻声劝止、日常提醒；不适合惊惧、哭泣或厉声质问。
- 清理：16 kHz 单声道 PCM；70 Hz 高通、7600 Hz 低通、轻度 `afftdn=nr=3:nf=-55`、短淡入淡出；无声源分离。原声参考约 4.19 秒。
- Whisper：原声完整；标准卡“些/歇”、试听“为她/被他”仍须人工逐字复核，未自动判为通过。
- CAMPPlus：原声→卡 `0.823108`，原声→试听 `0.768933`，卡→试听 `0.925126`。分数不能代替人工判断。
- 状态：候选保留，待用户 A/B 审核；完整文件哈希、响度、时长及耗时见同目录 `generation.json`。

## 周瑞家的

### `firm-instruction-v1`：明确交代规矩（待审候选）

- 标准卡：`content/audio/.cache/voice-cards/multistyle/zhou-rui-wife/firm-instruction-v1/voice-card.wav`
- 二次试听：`content/audio/.cache/voice-cards/multistyle/zhou-rui-wife/firm-instruction-v1/demo-delivery.mp3`
- 标准卡 WAV SHA-256：`ec739ac0f60aea072b1c91e7152706d19fe799142e1e81a8a26096c30320a078`
- 原声：第 27 集 `00:06:19.450–00:06:25.650`；尤氏问园门无人值守，叫“周姐姐”后周瑞家的说明关门规定。剧中称呼、前后剧情和近景口型确认身份。
- 原声准确文本：“一到天黑，就关门吹灯，不是园子里的人不许放进来。”
- 标准卡文本：“这件事须得说清楚，规矩既立下，谁也不能随意坏了。”
- 二次试听文本：“你把人叫来，当面问个明白，别叫旁人替你担着。”两段合成文案均为 AI 测试文案，不是演员原话。
- 声源性质：87 版中周瑞家的角色原声，非代理。适用于明确交代规矩、中等力度训示；不适用于失控怒吼、哭泣或柔和安慰。
- 清理：16 kHz 单声道 PCM；70 Hz 高通、7600 Hz 低通、轻度 `afftdn=nr=3:nf=-55`、约 −20 LUFS、短淡入淡出；未做人声分离。
- Whisper：清理前后原声同句；标准卡和试听均逐字匹配，无漏字、重复、乱序或拖尾。
- CAMPPlus：原声→卡 `0.755331`，原声→试听 `0.645234`，卡→试听 `0.903669`。原声→试听低于参考值，需重点听审声纹。
- 状态：只保留候选，尚不建议批准；第 81 回更强硬的斥责可能仍需另取声源。完整哈希、时长、响度和耗时见同目录 `generation.json`。

## 甄士隐

### `warm-encouragement-v1`：中秋夜平静劝勉（待审候选）

- 标准卡：`content/audio/.cache/voice-cards/multistyle/zhen-shiyin/warm-encouragement-v1/voice-card.wav`
- 二次试听：`content/audio/.cache/voice-cards/multistyle/zhen-shiyin/warm-encouragement-v1/demo-delivery.mp3`
- 标准卡 WAV SHA-256：`175882d42f0749a62b978e8017d37799419c6c724235a2e204e35732dfab7c92`
- 原声：第 1 集 `00:14:08.050–00:14:15.150`，甄士隐在中秋夜与贾雨村谈资助赶考之事；整段时间轴、局部口型、原著第 1 回情节确认身份。
- 原声准确文本：“我可早就有此心意了，只是老兄从未提起，所以不敢唐突。”
- 标准卡文本：“这件事说来话长，你且坐下，我慢慢讲给你听。”
- 二次试听文本：“世事变迁，人心却不能忘，咱们总要把缘故说清楚。”两段合成文案均为 AI 测试文案，不是演员原话。
- 声源性质：87 版中甄士隐的角色原声，非代理；适用于温和谈心、平静劝勉，不适用于第 81 回丧女悲诉、哭喊或失控怒斥。
- 清理：16 kHz 单声道 PCM，70 Hz 高通、7600 Hz 低通、轻度 `afftdn=nr=3:nf=-55`、约 −20 LUFS、短淡入淡出；没有做人声分离。
- Whisper：标准卡内容完整；试听中的“世事/事事”为同音识别差异，无漏句、重复或乱序。
- CAMPPlus：原声→卡 `0.755364`，原声→试听 `0.601259`，卡→试听 `0.905930`。原声→试听显著低于参考线，声纹漂移风险较高。
- 状态：只保留候选，待用户 A/B 听审；目前不建议批准或接入正式路由。完整哈希、时长、响度和生成耗时见同目录 `generation.json`。

## 贾政

### `studious-reflection-v2`：平稳谈读书（第 82 回待审候选）

- 标准卡：`content/audio/.cache/voice-cards/multistyle/jia-zheng/studious-reflection-v2/voice-card.wav`
- 二次试听：`content/audio/.cache/voice-cards/multistyle/jia-zheng/studious-reflection-v2/demo-delivery.mp3`
- 标准卡 WAV SHA-256：`4abfedfc17c04a2c0c19bda01e3267b20ed55fb853769d727a9d5ef1f74f9c32`
- 原声：第 31 集 `00:24:35.900–00:24:42.200`，贾政与王夫人谈宝玉读书和贾门举业；整集完整解码、局部时间轴、连续近景口型及前后对白确认。角色本人剧中原声，非代理。
- 原声文本：“说起来，家门还没有一个从举业上发迹的。”Whisper 清理前后均写为同音的“发计”，须用户听原片最终确认。
- 标准卡文案：“我看读书这件事，还是要脚踏实地，不能着急。”二次试听文案：“宝玉的功课我看过了，许多地方还要细细琢磨。”均为 AI 合成测试文案，非演员发言。
- 清理：16 kHz 单声道 PCM；70 Hz 高通、7600 Hz 低通、轻度 `afftdn=nr=3:nf=-55`、约 −20 LUFS、短淡入淡出；未做人声分离。适合平稳谈学业，不代表棒打时的愤怒语气。
- Whisper：标准卡全部字词匹配；Demo 将“宝玉”记为近音“保育”，无整句漏失、重复或乱序，须人工听审。
- CAMPPlus：原声→卡 `0.862930`，原声→Demo `0.771531`，卡→Demo `0.912932`；达到本项目候选参考线，但分数不能代替人工 A/B。
- 原始合成 WAV 真峰值 `+0.10/+0.21 dBTP`，审听用 delivery 版只分别整体衰减 `2/3 dB`，不覆盖原版。v1 失败试验保留于独立目录，原声→Demo 仅 `0.655164`。
- 状态：候选保留、待用户批准，不进入正式路由；完整哈希、时长、响度与两阶段耗时见同目录 `generation.json`。

## 贾赦

### `brisk-instruction-v1`：带笑意的吩咐（失败试验，不建议使用）

- 标准卡：`content/audio/.cache/voice-cards/multistyle/jia-she/brisk-instruction-v1/voice-card.wav`
- 二次试听：`content/audio/.cache/voice-cards/multistyle/jia-she/brisk-instruction-v1/demo-delivery.mp3`
- 标准卡 WAV SHA-256：`48b8ddeb7da22bce20212f24ab4e26259b079aab5845314cdb9071f699df9ef6`
- 原声：第 18 集 `00:31:49.900–00:31:57.100`，贾赦吩咐人向赖大家的传话；整集、局部时间轴和连续画面核对说话人。为剧中角色原声，非代理。
- 原声文本：“你们去告诉赖大家的，今天他家的酒宴席，我和大太太都不去了。”清理前后 Whisper 同句，仍待用户听原片逐字确认。
- 标准卡文案：“你们去把这件事说清楚，别叫人再来问我。”二次试听文案：“明日再请他过来，我还有几句话要当面交代。”均为 AI 合成测试文案，不是演员发言。
- 清理：16 kHz 单声道 PCM；70 Hz 高通、7600 Hz 低通、轻度 `afftdn=nr=3:nf=-55`、约 −20 LUFS、短淡入淡出；无声源分离。原声带笑意，不宜用于第 82 回平常议事。
- Whisper：标准卡和 Demo 字词完整；卡片“别叫人，再来问我”的停顿可能不自然，待听审。
- CAMPPlus：原声→卡 `0.667988`，原声→Demo `0.602734`，卡→Demo `0.901320`。前两组低于候选参考线，第一阶段就已明显偏离原声。
- 状态：仅留作失败试验；不批准、不进入正式路由，须重新选贾赦原声。全部哈希、时长、响度与耗时见同目录 `generation.json`。

## 贾惜春

### `painting-hesitation-v1`：说明画作难处（第 82 回待审候选）

- 标准卡：`content/audio/.cache/voice-cards/multistyle/jia-xichun/painting-hesitation-v1/voice-card.wav`
- 二次试听：`content/audio/.cache/voice-cards/multistyle/jia-xichun/painting-hesitation-v1/demo-delivery.mp3`
- 标准卡 WAV SHA-256：`a0799d6d00df66b9249bc5920c8eccdfb4110b43c49b66b78366c117878a2ded`
- 原声：第 17 集 `00:08:20.420–00:08:27.060`，惜春在稻香村向姊妹解释画大观园的难处；整集和逐秒联系表、连续话轮、第 42 回剧情共同确认。角色本人剧中原声，非代理。
- 原声文本：“我又不会工细楼台，又不会画人物，又不好驳回，正为这为难呢。”Whisper 将“工细/恭喜”“驳回/搏回”记为近音字；依据同场原著校正，待用户听原片确认。
- 标准卡文案：“这幅画先放在这里，等我想清楚再慢慢添上。”二次试听文案：“姐姐若有主意，不妨说给我听，我再试着画。”均为 AI 合成测试文案，不是演员真实发言。
- 清理：16 kHz 单声道 PCM；70 Hz 高通、7600 Hz 低通、轻度 `afftdn=nr=3:nf=-55`、响度统一及短淡入淡出；不做人声分离。适合克制解释、轻度为难，不适合厉声斥责或哭泣。
- Whisper：卡片文字完整；试听末字“画/话”同音识别差异，未见漏句、重复、错序或拖尾，仍待人工核对发音与自然度。
- CAMPPlus：原声→卡 `0.804075`，原声→试听 `0.756064`，卡→试听 `0.920118`；仅供辅助，不能代替试听。
- 状态：候选保留，待用户 A/B 审核，不进入正式路由；全部哈希、时长、响度及两阶段耗时见同目录 `generation.json`。

## 史湘云

### `clear-explanation-v1`：与翠缕谈阴阳（重新截取优先）

- 标准卡：`content/audio/.cache/voice-cards/multistyle/shi-xiangyun/clear-explanation-v1/voice-card.wav`
- 二次试听：`content/audio/.cache/voice-cards/multistyle/shi-xiangyun/clear-explanation-v1/demo-delivery.mp3`
- 标准卡 WAV SHA-256：`0cf915ebb3f31311c7a0ed55046d552de9d8b081f141a57db8b7e5eb6f355597`
- 原声：第 14 集 `00:28:49.300–00:28:53.680`，园中湘云答翠缕阴阳之问；整集与局部联系表、前后话轮和第 31 回剧情核对身份。角色本人剧中原声，非代理。
- 原声文本：“当然了，飞禽走兽，雄为阳，雌为阴。”原声 Whisper 把多处字记为同音字，按第 31 回同场语义校正，仍待用户听原片确认。
- 标准卡文案：“你且看清楚，这两件东西并不是一模一样的。”二次试听文案：“宝哥哥，园里的花开得正好，咱们过去瞧瞧。”均为 AI 合成测试文案，不是演员真实发言。
- 清理：16 kHz 单声道 PCM；70 Hz 高通、7600 Hz 低通、轻度 `afftdn=nr=3:nf=-55`、响度统一及短淡入淡出；不做人声分离。只适合日常说理，不覆盖醉后或激烈场面。
- Whisper：标准卡逐字匹配；试听开头“宝/报”“园里/原理”有近音差异，需听审是否自然。
- CAMPPlus：原声→卡 `0.839899`，原声→试听 `0.722808`，卡→试听 `0.861011`。后两组低于本项目约 `0.75/0.90` 的候选参考线。
- 状态：仅保留失败风险样本，优先重新截取更长、更干净的原声；不建议批准或进入正式路由。全部哈希、时长、响度、耗时及限制见同目录 `generation.json`。

## 妙玉

### `composed-explanation-v1`：克制说明茶水来历（第 82 回待审候选）

- 标准卡：`content/audio/.cache/voice-cards/multistyle/miao-yu/composed-explanation-v1/voice-card.wav`
- 二次试听：`content/audio/.cache/voice-cards/multistyle/miao-yu/composed-explanation-v1/demo-delivery.mp3`
- 标准卡 WAV SHA-256：`ae5ebd42a4ef74e3206105f0329f72709d8daf13fe18755a161049b067933bf5`
- 声源：第 16 集 `00:26:17.300–00:26:24.850`，栊翠庵内妙玉向黛玉解释梅花雪水；整集及逐秒联系表、连续近景口型、第 41 回剧情共同确认。角色本人剧中原声，非代理。
- 原声文本：“这是五年前我在蟠香寺住着收的梅花上的雪，埋在地下总是舍不得吃。”原声 Whisper 将“蟠/盘”“雪/血”记为同音字；剧版未说“玄墓”，因此未加入提示文本。专名仍需用户听原片确认。
- 标准卡文案：“这盏茶用的是梅花上的雪，滋味自然与寻常不同。”二次试听文案：“棋局还未定，你先静下心来，待我想清楚这一步。”两句都是 AI 合成测试文案，不是演员真实发言。
- 清理：16 kHz 单声道 PCM；70 Hz 高通、7600 Hz 低通、轻度 `afftdn=nr=3:nf=-55`、响度统一和短淡入淡出；未做人声分离。适合克制陈述、解释来历及平静论棋，不适合厉声训斥或哭泣。
- Whisper：标准卡“展/盏”、试听“其/棋”“带/待”为同音识别差异；未见整句漏失、重复或错序。仍须人工听审是否有音乐泄漏、降噪伪影及句尾串音。
- CAMPPlus：原声→卡 `0.873442`，原声→试听 `0.770934`，卡→试听 `0.908806`；仅作辅助，不等于声纹质量获批。
- 状态：候选保留，待用户 A/B 审核，不进入正式路由。全部文件哈希、时长、响度与两阶段耗时见同目录 `generation.json`。

## 翠缕

### `object-comparison-v1`：端详金麒麟（重新截取优先）

- 标准卡：`content/audio/.cache/voice-cards/multistyle/cui-lu/object-comparison-v1/voice-card.wav`
- 二次试听：`content/audio/.cache/voice-cards/multistyle/cui-lu/object-comparison-v1/demo-delivery.mp3`
- 标准卡 WAV SHA-256：`14020ec7b75da8af384f5177225767644a017a8d2f2e74658fd42e5e0743fbef`
- 原声：第 14 集 `00:29:18.430–00:29:22.490`，翠缕与湘云在园中比较金麒麟的雌雄；同场连续话轮、逐秒联系表、画面角色字幕和第 31 回情节核对身份。为剧中角色原声，非代理。
- 原声文本：“姑娘戴的这只像是母的，这只倒像是公的。”Whisper 把“戴/带”“只/支”记为近音字，结合画面物件校正，仍待用户逐字听原片确认。
- 标准卡文案：“姑娘先看看这两样，我怕自己认错了。”二次试听文案：“这边还有一件，我拿近些，您再仔细瞧瞧。”两句均是 AI 合成测试文案，不是演员真实发言。
- 清理：16 kHz 单声道 PCM；70 Hz 高通、7600 Hz 低通、轻度 `afftdn=nr=3:nf=-55`、约 −20 LUFS、短淡入淡出；不做人声分离。仅适合日常说明，不覆盖惊惧、哭泣或争吵。
- Whisper：标准卡和 Demo 均逐字匹配；未见漏字、重复、乱序或拖尾，仍需人工听审自然度。
- CAMPPlus：原声→卡 `0.824145`，原声→Demo `0.728763`，卡→Demo `0.880283`。后两组低于约 `0.75/0.90` 的候选参考线。
- 状态：只保留失败风险样本，建议另取更长、更干净的源声后重做，不批准也不进入正式路由。全部哈希、时长、响度与耗时见同目录 `generation.json`。

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

## 贾母（第 83 回选源试验，均未批准）

第 18 集两段贾母本人原声已分别做两阶段 CosyVoice 试验，均保存在本地忽略缓存，**不进入可用卡路由**。原 MPEG 在片段提取时报告可恢复的 MP2 帧错误，整集无误解码尚未确认；还需用户听原片逐字确认。

| 风格/版本 | 场景与适用性 | 原声准确文本（待原片人工复核） | 标准卡 WAV / SHA-256 | 验收结论 |
| --- | --- | --- | --- | --- |
| `concerned-inquiry-v1` | 第 18 集 `00:31:19.480–00:31:27.000`，问鸳鸯为何未归；仅供担忧询问参考，不适合临终 | “这还了得啊，原本她哥哥说接回家去，就送回来的。这回子怎么还不回来呀？” | `content/audio/.cache/voice-cards/multistyle/jia-mu/concerned-inquiry-v1/voice-card.wav` / `63325c7d02060d0dbc257ff710f97ac4f4b4b97e6965b993236a9a203e9c91b7` | 原声→卡/Demo `0.752/0.585`，卡→Demo `0.817`；二次声纹漂移，失败试验 |
| `warm-praise-v2` | 第 18 集 `00:33:00.300–00:33:06.550`，众女眷前称赞鸳鸯；仅供平和赞许参考，不适合临终 | “若论忠实可靠，孝顺主子，满府的丫头就属她了。” | `content/audio/.cache/voice-cards/multistyle/jia-mu/warm-praise-v2/voice-card.wav` / `bb08a3098dbadca9dec35acf74c6c0613044835890469a5e526bbf83d27b5331` | 原声→卡/Demo `0.670/0.623`，卡→Demo `0.877`；Demo 真峰值 `+0.07 dBFS`，失败试验 |

两版标准卡及 Demo 文案都是 AI 测试句，不是演员真实发言。完整来源、清理、时长、哈希、Whisper 与失败项见各自 `generation.json`。继续为第 83 回补贾母时，应重新寻找更洁净且无串音的影视原声，采用新的版本目录，不能覆盖本次试验。

## 林黛玉（重新取卡候选）

旧版 `content/audio.cache/voice-cards/daiyu/` 完整保留。本次另从第 19 集雨夜潇湘馆 `00:14:15.300–00:14:21.800` 取黛玉本人单句原声，做 `quiet-rain-v2`，适合轻声关照、略带倦意；不用于激烈争辩或悲恸。原声文本：“这回子夜深了，我要歇歇了，你先请回去吧。”口语“回/会”字仍待原片人工校对。标准卡合成文案：“夜已经深了，你先回去歇着，明日再慢慢说。”合成文案并非演员真实发言。

标准卡 `content/audio/.cache/voice-cards/multistyle/lin-daiyu/quiet-rain-v2/voice-card.wav`，SHA-256 `ad1c35dd48b9dc0cfc50b29ca321697bd514024dd96d275d48c623d7df2d7ec5`；来源与技术记录见同目录 `generation.json`。原声→卡 `0.793`，原声→Demo `0.671`，卡→Demo `0.887`；二次声纹漂移且 Demo 真峰值 `+0.07 dBFS`，仅保留待人工听审候选，**不覆盖或自动替换旧卡**。

## 秋纹（伤感风格新候选，未批准）

第 29 集 `00:18:35.080–00:18:39.700` 宝玉试穿晴雯遗物的场景，有约 4.62 秒秋纹本人对白。候选逐字稿：“这条裤子以后不要穿了，真是东西在，人没了。”Whisper small 已给出逐字时间戳；原著第 78 回的对白归属、视频联系表和与相邻麝月声音的差异共同支持身份，仍须听原片复核字词与边界。这段语气伤感，只考虑 `soft-remembrance-v1`，不作为日常音色。

原声候选 `content/audio/.cache/voice-cards/multistyle/qiu-wen/soft-remembrance-v1/source-original.wav`，SHA-256 `2be168387558a0ac32491b7be1311bebe070cdb7e74929aee793173f4ddd4a17`。已从清理参考严格生成标准卡“这些旧物先收起来吧，免得见了又想起她。”，再仅用标准卡生成 Demo“屋里还留着她做的针线，看着倒叫人心酸。”；两句均为 AI 测试文案，非演员真实发言。标准卡 `content/audio/.cache/voice-cards/multistyle/qiu-wen/soft-remembrance-v1/voice-card.wav`，SHA-256 `aa417e857632f86b6381ee3ac524e04e1d699a659fe3068ddec19fe1318feaca`。同目录 `generation.json` 记录所有原声、MP3、Demo 哈希、清理和验收。

CAMPPlus 原声→标准卡 `0.818`、原声→Demo `0.693`、标准卡→Demo `0.862`；后二项低于试点参考值。Whisper 将标准卡的“旧物先”识作“旧无心”，Demo 的“她/倒”识作同音字“他/刀”，需要人耳核查是否含混。三段都还未获用户 A/B 批准，因此**仅保留候选，不进入正式路由**；麝月不能与秋纹共享。

## 薛宝钗（第 84 回补缺，平稳劝说候选）

第 17 集 `00:05:07.500–00:05:12.600` 蘅芜院内宝钗向黛玉谈读书，整集解码、局部联系表持续口型及第 42 回剧情确认说话人。原声逐字稿：“这是书误了他，可惜他也把书给糟了。”原著写“遭塌了”，影视音频与之不同，不能拿原著句子代替音频提示。原声与清理版 Whisper 只把“书”误写为同音字“输”；最终仍请用户听原片核字。

新建 `composed-counsel-v1`，标准卡 AI 测试文案：“这件事且慢些定夺，先把前因后果理清楚。”二次 Demo AI 测试文案：“妹妹若有疑处，尽管来问我，咱们慢慢商量。”均非演员原话。标准卡 `content/audio/.cache/voice-cards/multistyle/xue-baochai/composed-counsel-v1/voice-card.wav`，SHA-256 `2ca54905baa5ca2bbd84cd20626dc0a89d6353035c27e99e0bd3c4fc990ead2c`；同目录 `generation.json` 记录全部来源、清理、时长、哈希与验收。适合从容讲理、温和商议，不适合第 84 回宝钗受辱失落或与薛蟠争执。

CAMPPlus 原声→卡 `0.832`、原声→Demo `0.714`、卡→Demo `0.895`。Whisper 将标准卡“且慢些”识作“前半些”，需听审咬字；合成卡真峰值约 `0 dBFS`，Demo 真峰值 `+0.1 dBFS`，也有转码过载风险。**仅保留待审候选，不进入正式路由**；第 84 回其余缺口见本地 `content/audio/.cache/voice-cards/chapter-084-audit.md`。

## 鸳鸯（第 84 回补缺，需重新选源）

第 18 集 `00:09:12.700–00:09:17.600` 鸳鸯呈帽子请贾母看花样，原声逐字稿候选：“老太太，您啊还是先看看这花样中不中吧。”整集、局部联系表、前后对白与口型支持人物身份；“啊”由短片逐字转写支持，待用户听原片最终核字。该源是人物本人影视对白，不是代理声。

`attentive-service-v1` 严格两阶段试验的标准卡文案：“老太太，东西都收拾妥当了，您且慢慢看。”二次 Demo：“院里的物件我已记下，回头再逐一核对。”两句都是 AI 合成测试文案，并非演员真实发言。标准卡 `content/audio/.cache/voice-cards/multistyle/yuan-yang/attentive-service-v1/voice-card.wav`，SHA-256 `ecfce3bd51cc3702ea34b0cab7c4fe972bef4359ace0d1025947b4de357710cd`；来源、清理、全部文件哈希、转写和耗时见同目录 `generation.json`。这一口吻只可用来测试日常恭谨回话，不适合激烈抗婚。

音频完整性与转写结构均通过，但 CAMPPlus 原声→卡 `0.583`、原声→Demo `0.422`、卡→Demo `0.873`，与原声声纹明显漂移。**保留失败样本供 A/B 对照，状态 `needs-resampling`，不可进入可用卡路由；应另截更稳的本人原声。**

另从第 18 集 `00:24:12.700–00:24:19.190` 园中抗婚对白重截 `defiant-refusal-v2`，与日常版独立保存。原声逐字稿候选：“家生女儿怎么样？牛不吃水强按头，我不愿意，难道他杀我的老子娘不成？”“强按”由 Whisper 误记为近音字，依原著第 46 回及画面语境校正；源音末尾与下一人说话的边界、背景声仍请用户听原片复核。标准卡 AI 测试文案：“这事我已经想明白了，谁来劝我也不会改主意。”Demo：“我自己的主意，自然由我亲口说个明白。”均非演员原话。标准卡 `content/audio/.cache/voice-cards/multistyle/yuan-yang/defiant-refusal-v2/voice-card.wav`，SHA-256 `a81712db6fc23b5b6b50672c050cc2f1125e34f13c3b3983ee198fdde0ee2caf`。

该版 CAMPPlus 原声→卡 `0.831`、原声→Demo `0.689`、卡→Demo `0.882`，比第一版稳定，但二次试听仍未达试点参考范围；Whisper 对卡和 Demo 的文本核对完整，Demo 真峰值接近 `0 dBFS`。**只作为坚定拒绝风格待审候选，不批准、不发布、不替代鸳鸯日常卡。**完整文件哈希、响度和耗时见 `defiant-refusal-v2/generation.json`。
