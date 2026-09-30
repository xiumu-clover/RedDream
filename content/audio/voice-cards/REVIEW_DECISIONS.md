# CosyVoice 人物音色卡试听决定（2026-09-28）

本表按用户试听的标准卡 MP3 SHA-256 绑定版本；音频本体仍只在 Git 忽略的本地缓存中。人工听审通过与 Whisper、CAMPPlus、响度等技术检查分开记录：**旧技术警告不会因听审通过而消失**。本表不修改正式音频路由、章节标注、网站 manifest 或发布文件。全部原声／标准卡／二次试听的路径与哈希见本地 `content/audio/.cache/voice-cards/review-decisions.json` 和各套 `generation.json`。

本轮 40 套：用户通过 37 套，宝玉情绪需重定名 1 套，不采用 2 套。贾政采用 `studious-reflection-v1` 而非 v2；黛玉采用 `quiet-rain-v2` 而非旧日常卡。宝玉 `restrained-sadness-v1` 不能再按“难过”使用，用户听感为“心里有点生气”；原目录和音频不移动或重命名，待另行确定新的风格 ID。

后续选角变更：迎春改与香菱共用 `xiangling/calm-poetry-talk-v1`；原迎春 `jia-yingchun/resigned-calm-v1` 改作秋纹代理声；原秋纹 `qiu-wen/soft-remembrance-v1` 留作未指定主要人物的备用卡。下表“用户通过”记录的是当时试听质量决定，**不表示仍分配给原人物**。现行分配以 [cosyvoice-casting.json](cosyvoice-casting.json) 为准，迎春新 Demo 尚待审核。

| 人物 | 卡片 ID | 审核决定 | 试听标准卡 MP3 SHA-256 | 用户意见／使用边界 |
| --- | --- | --- | --- | --- |
| 贾宝玉 | `jia-baoyu/restrained-sadness-v2` | 用户通过 | `54ab65a642769f2b5dcf375c0f6a128cd78e5ab11b59f41f588be01a60d9dc63` | 用户表示除列明的三项外，其余音色卡全部通过。机器技术警告仍照原记录保留。 |
| 袭人 | `xiren/assertive-rivalry-v1` | 用户通过 | `2fc00285696e7ed5214de0d1e9ccf105447e5993f2772f3939cd20eada954236` | 用户表示除列明的三项外，其余音色卡全部通过。机器技术警告仍照原记录保留。 |
| 春燕 | `chunyan/daily` | 用户通过 | `e02f88df1d54caa2affd1f962d4efee9127f6674a3be42f2e253ec52d628de66` | 用户表示除列明的三项外，其余音色卡全部通过。机器技术警告仍照原记录保留。 |
| 翠缕 | `cui-lu/object-comparison-v1` | 用户通过 | `3e388e1ef0027bacbf3416763ec021a80ce4785ce03d379ea20b809912a75a5b` | 用户表示除列明的三项外，其余音色卡全部通过。机器技术警告仍照原记录保留。 |
| 贾宝玉 | `jia-baoyu/anxious-indignant-v1` | 用户通过 | `bd366b2d373775c061aa8d64f2a91a4340f6e848b6e512b4930290284361c0c9` | 用户表示除列明的三项外，其余音色卡全部通过。机器技术警告仍照原记录保留。 |
| 贾宝玉 | `baoyu/daily` | 用户通过 | `80d0cef9495d3e43aaae002794c3c39f5d0bce71746b20411468a4b2d2e2943c` | 用户表示除列明的三项外，其余音色卡全部通过。机器技术警告仍照原记录保留。 |
| 贾宝玉 | `jia-baoyu/gentle-caring-v1` | 用户通过 | `0e55c41aa3ac19ce87c1ee32500e7365d91bdc1555548231e20862e478d0805b` | 用户表示除列明的三项外，其余音色卡全部通过。机器技术警告仍照原记录保留。 |
| 贾宝玉 | `jia-baoyu/gentle-caring-v2` | 用户通过 | `4c138f02b5a688f4a7c875eb2cb909fe4ca2121eb0df890f4623250db4210f02` | 用户表示除列明的三项外，其余音色卡全部通过。机器技术警告仍照原记录保留。 |
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
