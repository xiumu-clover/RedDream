# CosyVoice 人物音色卡试听决定（2026-09-28）

本表按用户试听的标准卡 MP3 SHA-256 绑定版本；音频本体仍只在 Git 忽略的本地缓存中。人工听审通过与 Whisper、CAMPPlus、响度等技术检查分开记录：**旧技术警告不会因听审通过而消失**。本表不修改正式音频路由、章节标注、网站 manifest 或发布文件。全部原声／标准卡／二次试听的路径与哈希见本地 `content/audio/.cache/voice-cards/review-decisions.json` 和各套 `generation.json`。

本轮 40 套：用户通过 37 套，宝玉情绪需重定名 1 套，不采用 2 套。贾政采用 `studious-reflection-v1` 而非 v2；黛玉采用 `quiet-rain-v2` 而非旧日常卡。宝玉 `restrained-sadness-v1` 不能再按“难过”使用，用户听感为“心里有点生气”；原目录和音频不移动或重命名，待另行确定新的风格 ID。

后续选角变更：迎春改与香菱共用 `xiangling/calm-poetry-talk-v1`；原迎春 `jia-yingchun/resigned-calm-v1` 改作秋纹代理声；原秋纹 `qiu-wen/soft-remembrance-v1` 留作未指定主要人物的备用卡。下表“用户通过”记录的是当时试听质量决定，**不表示仍分配给原人物**。现行分配以 [cosyvoice-casting.json](cosyvoice-casting.json) 为准，迎春新 Demo 尚待审核。

2026-10-02 补充：用户否决蒋玉菡 `graceful-recitation-v1`，原因是行酒令语态不适合日常对白；否决花自芳的甄士隐代理版，原因是甄士隐在第 81 回另有对白且年龄感偏大。替换版本 `jiang-yuhan/natural-explanation-v2` 和贾芸代理的花自芳 `young-brotherly-proxy-v2` 已由用户试听通过。批准绑定下表精确哈希；既有技术警告继续保留，且尚未自动写入正式章节路由。

2026-10-02 后续修订：用户在第 81 回第三小节确认 `jia-baoyu/gentle-caring-v2` 不适合作为宝玉声线。该卡从宝玉路由禁用，逻辑转入公共候选池且暂不分配人物；实体文件、原声来源和历史哈希不移动、不改名。任何新角色采用前仍须单独试听批准。

2026-10-03 后续修订：用户试听第 81 回第三小节后要求蒋玉菡、花自芳交换当前音色卡。蒋玉菡现使用贾芸 `earnest-assistance-v1` 代理卡；花自芳现使用蒋玉菡 `natural-explanation-v2` 代理卡。原表记录保留为历史审批证据，现行人物分配以 `cosyvoice-casting.json` 为准；交换不改变声源人物身份。

2026-10-15 后续修订：用户对第 81 回后两节选角试听中的年长女眷池、年轻丫鬟池、`081-b0302` 未具名年轻丫鬟和夏金桂四项明确通过；批准分别绑定代理 Demo MP3 SHA-256 `fcd0bc02d7d58327075a72ec471d8257d85fbaea6c8696dbcd776b68f7032cbf`、`4b0a59cb5d8bf9847ce840046dedff096da957be2e96a5803a4066b175277484`、`6231c485beda7847f1fd48d6c9923e105c3262793d6a03a17a865e24b99f0f73` 和 `3c7b3eeb15bdb013e179b9f477ff7123d203f938d5168db5f1878b0dca7c8c8e`。代理身份与技术警告保留；`081-b0302` 在正式标注拆分前仍不得路由。原潘又安贾芸代理版未被选中，2026-10-16 生成的三个新候选仍待用户选择。

2026-10-16 后续修订：用户在潘又安三个新代理候选中选择第 3 版，即蒋玉菡 `natural-explanation-v2` 代理声。批准绑定标准卡 WAV SHA-256 `171f301580c98d531c08c3bc6425f0a5de35940a9312508ffc10159d600f5be7` 和试听 MP3 SHA-256 `113e8dd461b480fcc2e6684296f51b6d3bf6c989e48606cf98bb13c0c78b6aa5`；该声源不是潘又安或其演员原声，既有声纹漂移警告保留。

2026-10-18 后续修订：用户确认小鹊沿用第 81 回末已经听审确定的 `unknown-visitor` 声卡。该别名底层实际为贾政 `jia-zheng/studious-reflection-v1` 代理声，不能描述为小鹊或其演员本人原声。第 82 回新提取的莲花儿代理 `xiao-que-xiao-jixiang/light-reporting-v1` 不再分配给小鹊，音频与来源元数据保留为备用候选；第 82 回“小鹊、小吉祥”共同发言如采用单一代表声，以小鹊的 `unknown-visitor` 为主声。

同日，用户将第 82 回其余新补卡暂定采用：林之孝家的本人原声、贾环本人原声、贾蔷本人原声、贾蓉本人原声，以及邢岫烟←香菱、雪雁←春燕、钱槐←贾芸、贾蓁←蒋玉菡四张代理原声。这里的“暂定采用”是选角决定，不抹除 `needs-transcript-review`、低响度或风格局限，也不把代理声描述成目标人物原声；后续用户可随时要求换卡。

| 人物 | 卡片 ID | 审核决定 | 试听标准卡 MP3 SHA-256 | 用户意见／使用边界 |
| --- | --- | --- | --- | --- |
| 蒋玉菡 | `jiang-yuhan/natural-explanation-v2` | 用户通过 | `9325906ee8d7c60b2b926db86bf1b3d45ab8ebaa20bb748a2b3e1a3757bfc1e3` | 用户明确表示新版可以；只批准正常说明风格，旧行酒令版仍为否决。声纹漂移等技术警告保留。 |
| 花自芳 | `jia-yun/earnest-assistance-v1`（贾芸代理） | 用户通过 | `a143698781ebcfee0e8024f9f97261c6ecc9a7a19a8e58091d95d75a8cdbcf65` | 用户明确表示新版可以；批准范围是用于花自芳代理，不把该声源描述为花自芳原声，也不等于批准为贾芸正式卡。 |
| 贾宝玉 | `jia-baoyu/restrained-sadness-v2` | 用户通过 | `54ab65a642769f2b5dcf375c0f6a128cd78e5ab11b59f41f588be01a60d9dc63` | 用户表示除列明的三项外，其余音色卡全部通过。机器技术警告仍照原记录保留。 |
| 袭人 | `xiren/assertive-rivalry-v1` | 用户通过 | `2fc00285696e7ed5214de0d1e9ccf105447e5993f2772f3939cd20eada954236` | 用户表示除列明的三项外，其余音色卡全部通过。机器技术警告仍照原记录保留。 |
| 春燕 | `chunyan/daily` | 用户通过 | `e02f88df1d54caa2affd1f962d4efee9127f6674a3be42f2e253ec52d628de66` | 用户表示除列明的三项外，其余音色卡全部通过。机器技术警告仍照原记录保留。 |
| 翠缕 | `cui-lu/object-comparison-v1` | 用户通过 | `3e388e1ef0027bacbf3416763ec021a80ce4785ce03d379ea20b809912a75a5b` | 用户表示除列明的三项外，其余音色卡全部通过。机器技术警告仍照原记录保留。 |
| 贾宝玉 | `jia-baoyu/anxious-indignant-v1` | 用户通过 | `bd366b2d373775c061aa8d64f2a91a4340f6e848b6e512b4930290284361c0c9` | 用户表示除列明的三项外，其余音色卡全部通过。机器技术警告仍照原记录保留。 |
| 贾宝玉 | `baoyu/daily` | **用户禁用** | `80d0cef9495d3e43aaae002794c3c39f5d0bce71746b20411468a4b2d2e2943c` | 第82回首节试听后用户明确禁用；WAV SHA-256 `e74dfcf3e088718036668b95fe921ed98c7eb32bd3a350975af19df4ba3f4877`。宝玉沿用第81回 restrained-sadness-v2，原文件仅供追溯。 |
| 贾宝玉 | `jia-baoyu/gentle-caring-v1` | 用户通过 | `0e55c41aa3ac19ce87c1ee32500e7365d91bdc1555548231e20862e478d0805b` | 用户表示除列明的三项外，其余音色卡全部通过。机器技术警告仍照原记录保留。 |
| 公共候选池（原贾宝玉来源） | `jia-baoyu/gentle-caring-v2` | 宝玉禁用；公共池未分配 | `4c138f02b5a688f4a7c875eb2cb909fe4ca2121eb0df890f4623250db4210f02` | 用户确认该声线不适合作为宝玉；保留来源事实和文件，禁止宝玉路由。分配其他角色前须重新试听。 |
| 贾宝玉 | `jia-baoyu/grieving-shock-v1` | 用户通过 | `d2ec7efdd38b6871e5239d6c75fcec52e4aa73c88ba7def131704f29cbbfcdca` | 用户表示除列明的三项外，其余音色卡全部通过。机器技术警告仍照原记录保留。 |
| 贾宝玉 | `jia-baoyu/grieving-shock-v2` | 用户通过 | `5df2493f95e54f1f4e020a8cbcbd9c15a5f7ad086d9fc7a418f205e1574e877f` | 用户表示除列明的三项外，其余音色卡全部通过。机器技术警告仍照原记录保留。 |
| 贾宝玉 | `jia-baoyu/restrained-sadness-v1` | 情绪待重定名；不能按伤心使用 | `f3c8ad77bdbeafd69b166ba3530261939710252f4720899e38fb95d6312d5346` | 用户认为听感不像难过，反而像心里有点生气；不得再作为 sadness 风格选用。保留原文件，待复核后另定风格名。 |
| 贾母 | `jia-mu/concerned-inquiry-v1` | 用户通过 | `1028e33b85e55addd19f0e156a874e5e70f53e4d9a1fbbed6bb5a84ca918d4b8` | 用户表示除列明的三项外，其余音色卡全部通过。机器技术警告仍照原记录保留。 |
| 贾母 | `jia-mu/warm-praise-v2` | 用户通过 | `83199db719018dacbcc9ad2f72d75d52a624bc49282f9a2bc22b70f1e3b67708` | 用户表示除列明的三项外，其余音色卡全部通过。机器技术警告仍照原记录保留。 |
| 贾赦 | `jia-she/brisk-instruction-v1` | 用户通过 | `fd29171076efa668c31cbbab9dd8b21263c36dcbd434d0c0fcfd259ffef6b51f` | 用户表示除列明的三项外，其余音色卡全部通过。机器技术警告仍照原记录保留。 |
| 贾惜春 | `jia-xichun/painting-hesitation-v1` | 用户通过 | `27857ac833bc1394f61dab1f57db752e7a47eba595b06cc20d29feade7824b88` | 用户表示除列明的三项外，其余音色卡全部通过。机器技术警告仍照原记录保留。 |
| 贾迎春 | `jia-yingchun/resigned-calm-v1` | 用户通过 | `e2e547745766e48caef9d8b93f9b988a18a39d3085a2c736055fde7aaa7bb59f` | 用户表示除列明的三项外，其余音色卡全部通过。机器技术警告仍照原记录保留。 |
| 贾政 | `jia-zheng/studious-reflection-v1` | 用户通过 | `e535c96849729c9e4ee4f5b37a879b9ea7ca6bba6905f60cc53dadc4371070a8` | 用户表示除列明的三项外，其余音色卡全部通过。机器技术警告仍照原记录保留。 |
| 贾政 | `jia-zheng/studious-reflection-v2` | 用户不采用；历史文件保留 | `3f4801df5d778770e20eedc08a904d0ff30ef4bb54ae556e7f630274dd226626` | 用户表示贾政 v1 已足够，v2 可以不要；文件保留但不选用。 |
| 葵官 | `kui-guan/proxy-cast` | 用户通过 | `201b5b22d640c17487bc36ce215ca07bc29f00770861a307d2b00b7b6fb42be0` | 用户表示除列明的三项外，其余音色卡全部通过。机器技术警告仍照原记录保留。 |
| 林黛玉 | `daiyu/old-daily` | 用户不采用；历史文件保留 | `ac7be719668cb3bbb30f07f871d44525d422b28265564a3375230d59d6482c66` | 用户明确表示黛玉旧版不要；只保留此前已批准的 quiet-rain-v2。 |
| 妙玉 | `miao-yu/composed-explanation-v1` | 用户通过 | `643d406d479fede1bc412c4def97f09215caaad4ad3e9831231e203efb63c351` | 用户表示除列明的三项外，其余音色卡全部通过。机器技术警告仍照原记录保留。 |
| 平儿 | `ping-er/discreet-explanation-v1` | 用户通过 | `c6718d6f5cbd8798adbc80cf5559b095b13f5e1167d9a66bfd605827cb04544d` | 用户表示除列明的三项外，其余音色卡全部通过。机器技术警告仍照原记录保留。 |
| 麝月 | `she-yue/practical-light-v1` | 用户通过 | `b9e6ee09aa5fdd2f07a116403b57d9207fef0c46c1d155e63dcadb8779e44051` | 用户表示除列明的三项外，其余音色卡全部通过。机器技术警告仍照原记录保留。 |
| 史湘云 | `shi-xiangyun/clear-explanation-v1` | 用户通过 | `60e270eb78d3bd580840ac070450f42953adcd826aeff38c1db9dcdf992b43f4` | 用户表示除列明的三项外，其余音色卡全部通过。机器技术警告仍照原记录保留。 |
| 司棋 | `siqi/current-candidate` | 用户通过 | `dd88c782b1c9394acc11ccb7b4b54b9733757d57f64bbfb566585f0fcac9b661` | 用户表示除列明的三项外，其余音色卡全部通过。机器技术警告仍照原记录保留。 |
| 司棋 | `siqi/v1-technical-reject` | 用户通过 | `73aaa8d569ec4971320d986d5069dc60a16643fe7036712cd3dbb9969467ab7d` | 用户表示除列明的三项外，其余音色卡全部通过。机器技术警告仍照原记录保留。 |
| 司棋 | `siqi/v2-review` | 用户通过 | `d9dcea43b703685add14490924a417a8e725abdfdcae2085da9d8e38214f8424` | 用户表示除列明的三项外，其余音色卡全部通过。机器技术警告仍照原记录保留。 |
| 王夫人 | `lady-wang/daily` | 用户通过 | `c9afd9c7aa678c7c993125baff6eb83ba467c97517f8956c2da482b0025fdbd4` | 用户表示除列明的三项外，其余音色卡全部通过。机器技术警告仍照原记录保留。 |
| 王熙凤 | `wang-xifeng/practical-caution-v1` | 用户通过 | `a1a8ffc0a4d0586d5aae1fb99cf89679075ed774d61b0b7da5f622cd0ffd8647` | 用户表示除列明的三项外，其余音色卡全部通过。机器技术警告仍照原记录保留。 |
| 袭人 | `xiren/daily` | 用户通过 | `ac90821f2e580c48b0b6c10f2bae63c0bd435c027a2bf75c00d0568093064d0d` | 用户表示除列明的三项外，其余音色卡全部通过。机器技术警告仍照原记录保留。 |
| 香菱 | `xiangling/calm-poetry-talk-v1` | 用户通过 | `94b0df6acb8d4b0ed3e8f7f9c8eb1dfa384dd26a267a21ebd25b0d9955f67e03` | 用户表示除列明的三项外，其余音色卡全部通过。机器技术警告仍照原记录保留。 |
| 邢夫人 | `lady-xing/restrained-persuasion-v1` | 用户通过 | `a3e9961cd72ca4d0f546ad1c49c844c2ea6c864d30f3fa022eb4b86bbc2abc76` | 用户表示除列明的三项外，其余音色卡全部通过。机器技术警告仍照原记录保留。 |
| 甄士隐 | `zhen-shiyin/warm-encouragement-v1` | 用户通过 | `a7c973513934550fb5455207a9d024764a4b46d74c25f786cd7c33a044a7c904` | 用户表示除列明的三项外，其余音色卡全部通过。机器技术警告仍照原记录保留。 |
| 周瑞家的 | `zhou-rui-wife/firm-instruction-v1` | 用户通过 | `5e8e9f29cc2c1586a29d8705c7ca55d0fc0d03a27e2cd7fe428537a0c3b533f8` | 用户表示除列明的三项外，其余音色卡全部通过。机器技术警告仍照原记录保留。 |
| 紫鹃 | `zi-juan/gentle-reproach-v1` | 用户通过 | `c7c1d357f904d192ba4ebad4c945e230fa41cefbb8fbb87e9ce7146e3f9cb102` | 用户表示除列明的三项外，其余音色卡全部通过。机器技术警告仍照原记录保留。 |
| 林黛玉 | `lin-daiyu/quiet-rain-v2` | 用户通过 | `7dcf8d06cfff08070a3bc1cfd3e14b3bd6dc81522341d5238af2e1276514329b` | 用户表示除列明的三项外，其余音色卡全部通过。机器技术警告仍照原记录保留。 |
| 秋纹 | `qiu-wen/soft-remembrance-v1` | 用户通过 | `3c2311213841fcf83274bf15eb99a2793a3c9e3ace08e478cdc3d987c0b631ce` | 用户表示除列明的三项外，其余音色卡全部通过。机器技术警告仍照原记录保留。 |
| 薛宝钗 | `xue-baochai/composed-counsel-v1` | 用户通过 | `21c489456f769456f2c171aad46440664b5e57eccdd0d302b8495dce7df5b518` | 用户表示除列明的三项外，其余音色卡全部通过。机器技术警告仍照原记录保留。 |
| 鸳鸯 | `yuan-yang/attentive-service-v1` | 用户通过 | `ceaeec52ea5d2c135d6ab5e2b9a4e66708098c019d8f04edf60772223eb2a94c` | 用户表示除列明的三项外，其余音色卡全部通过。机器技术警告仍照原记录保留。 |
| 鸳鸯 | `yuan-yang/defiant-refusal-v2` | 用户通过 | `97d1acff5941ebfff23c5690212a8be9d5cc30834daa7703ac6e3e7cb1704639` | 用户表示除列明的三项外，其余音色卡全部通过。机器技术警告仍照原记录保留。 |
