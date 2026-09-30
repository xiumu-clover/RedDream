# GPT 回目风格评审

脚本只提取回目、校验GPT评审、汇总分数，不进行文学评分，不调用模型API。默认模型为 `gpt-6-astra`，推理设置 `high`，未锁定快照。来源设置必须如实记录；仅使用同一个模型名称不能保证底层权重不变。

## 首次使用

从项目根目录执行：

```powershell
npm run title:prepare
npm run title:export -- --calibration
npm run title:export
```

命令打印产物绝对路径。默认研究目录为 `research/文风审验/回目/`，不参与网站构建。`prepared/<评审版本>/` 保存八十回参考原文、规范化文本、固定量表、12个校准案例和返回JSON结构。

导出结果分别位于 `runs/<运行组哈希>/<批次>/`。每个运行有 `round-1.md`、`round-2.md`、`round-3.md` 及对应JSON。向三次**相互独立的GPT上下文**分别提供相应轮次的Markdown；不要提供清单、其他轮次评分、正文、候选来源或历史建议。三轮固定使用相同量表、示例及八十回参考。模型给出文字判断，脚本不替模型补分。

将各轮响应存为JSON，再导入。以下 `$calibrationRun`、`$titleRun` 分别填入上面两次export打印的目录；`$calibrationReviews`、`$titleReviews` 是三份响应JSON所在的目录：

```powershell
npm run title:report -- --run "$calibrationRun" --reviews "$calibrationReviews"
npm run title:report -- --run "$titleRun" --reviews "$titleReviews" --calibration-run "$calibrationRun"
```

也可把响应直接写到运行目录的 `reviews/`，此时省略 `--reviews`。不要同时直接放置又导入同一轮，否则会被识别为重复。导入路径含空格时加引号。

`report` 保存Markdown和JSON到 `reports/<结果哈希>/`，从不覆盖此前报告。响应不完整或不合法时，仍输出未完成报告并以退出码2结束；程序/输入错误退出码1，正常结束为0。原始响应保留在 `reviews/`；错误文件必须修正时，应保存在旁边的 `rejected/` 再提供修正版，不能悄悄改原始评分。

## 候选比较

候选文件使用JSON数组，每条记录含 `id`（不重复）、`chapter`、`upper`、`lower`。例如：

```json
[
  {"id":"a","chapter":81,"upper":"惜昵近公子做良媒","lower":"讳笞罚丫鬟结恶党"},
  {"id":"b","chapter":81,"upper":"惜亲近公子做良媒","lower":"避笞罚丫鬟结恶党"}
]
```

示例仅说明输入格式，不代表改名建议。运行：

```powershell
npm run title:export -- --input research/drafts/回目候选.json
npm run title:export -- --book guiyou-original
```

同回候选双方稳定且总分差至少10分时，可导出正反序比较包：

```powershell
npm run title:export -- --compare-run "$titleRun"
```

比较包包含两轮，分别在独立上下文评审，轮次2交换左右顺序。导入方式与评分包相同。再用 `--comparisons "$comparisonRun"` 重新生成评分报告：

```powershell
npm run title:report -- --run "$titleRun" --calibration-run "$calibrationRun" --comparisons "$comparisonRun"
```

只有校准通过、双方评分稳定、差距达到阈值、正反序比较明确偏好同一候选时，报告才显示“明确偏好”。差距不足10分不强排高低；多于两个候选分别展示符合条件的候选对，不把循环偏好强行变成全局排名。

## 评分、稳定性与历史

- 句法与节奏、对仗与照应、措辞与称谓、章回叙事口吻四项各0—5整数分。每项必须有简短文字依据及至少一个参考回目的准确原文引用。问题必须含候选原字串、原因及修改方向。
- 每项取三轮中位数，四项之和乘5得到总分；不是三轮总分的中位数。
- 总分最大差超过10分，或任一单项最大差超过1分，标记“评审不稳定”；保留三轮全部分数和评语。
- 校准案例是4个不同句式的原回目、4个明确生硬改写及4个边界案例，与量表示例分开。12例须全部完成，其中至少11例稳定才通过。此门槛检验重复一致性，不能证明文学判断正确，也不构成作者识别准确率。
- 同输入默认复用原运行；加 `--fresh` 建立新批次并重新进行三轮评审。禁止把一次输出复制成三轮或为获得通过而手改分数。
- 基准、量表、示例、提示词、归一化规则版本、模型设置、返回结构及校准案例共同参与评审版本哈希。正文变化不影响版本；上述条件变化后须重新校准。旧报告仍保留，但重导入旧结果会显示失效。
- 工具验证各轮模型设置与不同上下文标识；无法单凭JSON证明上下文真实隔离。`contextId`应使用实际会话/代理标识，`timestamp`为真实UTC时间。不能确认快照时填 `null`。
- 只分析标题，不判断题文吻合、不引用模型记忆中的剧情、不强套律诗平仄。脚本单列8／8字数检查，不把格式变成文学分。
- 首次校准不通过时，先查看分歧维度、修订量表版本，再建立新的三轮评审；不要丢弃旧结果或挑选有利轮次。

输出只代表固定量表下的风格相容判断，不是同一作者概率。输入原文和文件来源只从章节主标题提取；正文不进入评审包。

## 测试

```powershell
node --experimental-strip-types --test tests/style-audit/titles.test.ts
npm run test:tools
```

合成评分仅用于程序测试；真实交付报告必须由实际GPT评审结果生成。网站运行及构建不依赖这些研究产物。
