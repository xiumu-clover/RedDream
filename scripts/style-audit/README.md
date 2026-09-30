# 文风相容度工具

回目文字另用 [GPT 回目评审工具](titles/README.md)：`title:prepare`、`title:export`、`title:report`。它使用独立的固定量表和三轮GPT评审，不套用下述正文模型。

该工具把“像不像前八十回”拆成两个可复现通道：可解释的风格特征，以及字符语言模型的 BPC/困惑度。所得分数是相对于未参与训练的原著片段所作的经验相容度，不是作者身份概率。

## 本地基线

从项目根目录运行：

```sh
npm run style:prepare
npm run style:train
npm run style:audit -- --input research/drafts/待审片段.txt
npm run style:report
npm run style:reference-report
```

也可以通过 `--corpus`、`--model`、`--output` 指定产物路径。`audit` 接受一个 `.txt`/`.md` 文件或一个包含这些文件的目录。结构化 Markdown 使用章节 AST 清洗；普通文本会移除首行回目和方括号夹批。少于 200 字的输入会拒绝评分，200—599 字会标注低置信度。

默认流程只从 `content/chapters/hongloumeng/` 读取 001—080 回：

- 训练：1、3、5、13、17—18、40、49、53、57、62、74、77；
- 校准与冻结测试：其余回目按整回、时期分层后以固定种子划分；
- 第 17—18 回始终属于同一交叉验证折；
- 诗词赋保留在语料的 `verse` 轨，但不进入散文总分；
- 081 回以后的目录不在准备、训练或校准代码路径中。

总分为 60% 特征通道加 40% 字符语言模型通道。任一通道低于 5 即报警；5—20 为偏弱。高于 95 会提示检查复写。章节聚合使用片段中位数与最差 10% 尾部，不让平均值掩盖局部差段。

`style:reference-report` 另行生成前八十回逐回基准表。训练回采用整回分组交叉验证，校准回明确标为分布诊断，冻结回保持严格未见；报告还会对全部八十回比较 2—6 个探索性类别。该报告用于检查基准内部结构，不改变训练集，也不会读取 081 回以后的文本。

考虑到前八十回可能混有两种文本系统，模型先按训练章节的特征均值做确定性的二簇聚类，再分别建立参考中心和字符语言模型。候选按与其最相容的风格簇评分，并同时报告特征/语言模型的 A、B 簇归属。silhouette 与两簇回目都会写入模型和报告；这些簇可能来自体裁、场景或版本差异，不能直接解释成两位作者。

## 神经 LoRA 通道

神经阶段是可选增强，要求 Python 3.11、CUDA GPU，并固定使用 `neural/config.json` 中的模型 revision：

```sh
python -m pip install -r scripts/style-audit/neural/requirements.txt
python scripts/style-audit/neural/train.py --corpus research/文风审验/reference-corpus.json --style-model research/文风审验/model/style-audit-model.json --cluster 0 --fold 0 --output research/文风审验/neural/a-fold-0
```

对 A/B 两簇及 0—4 五折分别运行，分别取各簇 `metrics.json` 中最佳步数的中位数，再训练两个全量适配器：

```sh
python scripts/style-audit/neural/train.py --corpus research/文风审验/reference-corpus.json --style-model research/文风审验/model/style-audit-model.json --cluster 0 --max-steps A_BEST_STEP_MEDIAN --output research/文风审验/neural/final-a
python scripts/style-audit/neural/train.py --corpus research/文风审验/reference-corpus.json --style-model research/文风审验/model/style-audit-model.json --cluster 1 --max-steps B_BEST_STEP_MEDIAN --output research/文风审验/neural/final-b
python scripts/style-audit/neural/score.py --corpus research/文风审验/reference-corpus.json --audit research/文风审验/runs/latest-audit.json --adapter research/文风审验/neural/final-a/adapter --adapter research/文风审验/neural/final-b/adapter --output research/文风审验/runs/latest-neural.json
npm run style:audit -- --input INPUT --neural-results research/文风审验/runs/latest-neural.json
```

神经通道同时保留基础模型 BPC、LoRA BPC 与 style lift。若它与字符模型的相容度相差超过 20 分，工具拒绝给出总体强结论。
