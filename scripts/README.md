# 维护脚本

```text
scripts/
  audio/                   有声书正文清理、分段与 TTS provider
  chapters/                章节导入、拆分等一次性维护工具
  style-audit/             前八十回文风特征与困惑度审验工具
  research/
    characters/            人物卡引用核验和上下文工具
    zhipi/                 脂批提取与分类管线
    paths.cjs              研究脚本共用的可移植路径配置
```

常用命令：

```sh
npm run audio:generate -- 81
npm run audio:publish -- 81 --check
npm run audio:review:push
npm run audio:review:pull
npm run extract:zhipi
npm run style:prepare
npm run style:train
npm run style:audit -- --input research/drafts/待审片段.txt
npm run style:report
npm test
```

## 网站与音频的独立检查

`npm run test:site` 只检查章节解析、目录布局和音频清单的容错行为；`npm run test:audio` 检查有声书生成链路；`npm run test:tools` 检查研究与文风工具。`npm test` 在本地依次运行全部检查。

GitHub Actions 的 `Scheduled Astro build` 只以网站检查和 `npm run build` 作为正文发布门槛，定时或手动运行成功后才调用 Cloudflare Pages Deploy Hook。独立的 `Audio checks` 工作流运行音频测试，不合成音频、不发布音轨，也不阻断正文部署。音频生成及发布仍由本地脚本控制。若已发布的音频清单缺失或格式损坏，章节页会暂时隐藏播放器并继续构建正文；修复清单后重新构建即可恢复。

## 文风相容度审验

`style:prepare` 只读取 `content/chapters/hongloumeng/` 的 001—080 回，固定用第 1、3、5、13、17—18、40、49、53、57、62、74、77 回训练，并按整回划分校准集和冻结测试集。它会剔除回目、脂批、蒙批、尾注、图片和夹批，将诗赋另存为独立轨道，再按完整句读生成可追溯片段。

`style:train` 生成特征模型和字符 1—5 gram 困惑度模型。当前基准模型的冻结测试状态必须为 `validated` 才能作为正式参考；输出分数称为“参考文风相容度”，不是作者归属概率。`style:audit` 接受单个 `.md`/`.txt` 或包含这些文件的目录，生成 JSON；`style:report` 再生成 Markdown 审稿报告。派生语料、模型和报告均默认写入私有的 `research/文风审验/`。

基准允许训练回目形成两个章节级参考风格簇，候选按最近簇评价并报告 A/B 倾向。风格簇只用于容纳前八十回内部异质性，不能据此断言作者人数。

神经通道位于 `style-audit/neural/`，固定使用 Qwen3-0.6B-Base 的指定 revision 与 LoRA 配置。先在 Python 3.11 + CUDA 环境执行五折训练，取最佳步数中位数后再全量训练；当前 CPU 主机不运行这一阶段。神经结果通过 `style:audit -- --input ... --neural-results ...` 合并，若其与字符模型相差超过 20 分，报告会标为“结论不稳定”。

音频生成器只接受 `content/chapters/guiyou/` 中的第 81–108 回。它从章节 AST 建立稳定的旁白、对话和诗词块；缺少或过期标注时先写入私有研究仓库的 `research/drafts/audio-annotations/NNN.request.md` 并停止，标注齐全后只合成变化片段，最终男女整轨留在 `content/audio/.cache/tracks/`。

生成与发布互相独立。`publish_audio.bat` 会检查本地整轨、hash、时长和 Cloudflare Pages 25 MiB 单文件限制；第一阶段发布白名单只有第 81 回。详见 `docs/audio_architecture.md`。

对白只通过私有云评审应用审批。本地不运行审核 Web 服务；`audio:review:push` 只上传当前待审的精确哈希音频，`audio:review:pull` 将云端通过和重录意见同步为版本化审批记录与工作单。云应用部署说明见 `audio/cloud-review/README.md`。

脚本从项目根目录运行，禁止写死某台电脑的绝对路径。研究类命令要求 `research/` 私有仓库已经克隆；缺失时会给出明确提示。新增脚本时按用途放入现有子目录；只有出现新的独立领域时才增加一级分类。
