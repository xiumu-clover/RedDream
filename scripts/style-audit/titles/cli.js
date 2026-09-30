import { exportRun, prepare, reportRun } from './workflow.js';

const usage = `回目风格评审（GPT评审包工作流，不调用API）
  title:prepare [--output DIR]
  title:export  [--book guiyou|guiyou-original | --input FILE | --calibration | --compare-run RUN] [--fresh] [--output DIR]
  title:report  --run RUN [--reviews FILE_OR_DIR] [--calibration-run RUN] [--comparisons RUN]

默认目录：research/文风审验/回目；每次命令打印产物绝对路径。
相同输入复用批次；--fresh生成新批次，历史记录不覆盖。
report导入有问题或缺少评审时生成未完成报告，退出码为2。
`;
function argumentsOf(argv) {
	const [command, ...args] = argv;
	const options = {};
	const flags = new Set(['calibration', 'fresh', 'help']);
	const known = new Set(['output', 'book', 'input', 'calibration', 'compare-run', 'fresh', 'run', 'reviews', 'calibration-run', 'comparisons', 'help']);
	for (let i = 0; i < args.length; i++) {
		const key = args[i].replace(/^--/u, '');
		if (!args[i].startsWith('--') || !known.has(key)) throw new Error(`未知参数：${args[i]}`);
		if (options[key] !== undefined) throw new Error(`参数重复：${key}`);
		if (flags.has(key)) options[key] = true;
		else {
			if (!args[i + 1] || args[i + 1].startsWith('--')) throw new Error(`--${key}缺少值。`);
			options[key] = args[++i];
		}
	}
	return { command, options };
}
async function main() {
	const { command, options: o } = argumentsOf(process.argv.slice(2));
	if (!command || o.help) { process.stdout.write(usage); return; }
	const root = process.cwd();
	if (command === 'prepare') {
		const result = await prepare(root, o.output);
		process.stdout.write(`参考集与量表：${result.directory}\n评审版本：${result.baseline.evaluationVersion}\n`);
	} else if (command === 'export') {
		if (['book', 'input', 'calibration', 'compare-run'].filter((k) => o[k] !== undefined).length > 1) throw new Error('book/input/calibration/compare-run须择一。');
		const result = await exportRun(root, { output: o.output, input: o.input, book: o.book, calibration: o.calibration, compareRun: o['compare-run'], fresh: o.fresh });
		process.stdout.write(`评审包：${result.directory}\n候选数：${result.manifest.candidates.length}\n每轮使用独立上下文，结果保存为JSON，再运行title:report导入。\n`);
	} else if (command === 'report') {
		if (!o.run) throw new Error('report必须提供--run。');
		const result = await reportRun(root, { run: o.run, reviews: o.reviews, calibrationRun: o['calibration-run'], comparisons: o.comparisons });
		process.stdout.write(`报告：${result.directory}\n${result.report.calibration ? `校准：${result.report.calibration.status}` : `完成：${result.report.summary?.completedCount ?? '比较'}/${result.report.summary?.count ?? ''}`}\n`);
		if (result.report.errors.length || result.report.stale || result.report.candidates?.some((c) => c.status === '未完成') || result.report.calibration?.status === '未通过' || (!result.report.candidates && result.report.comparisons.some((c) => c.status === '未完成'))) process.exitCode = 2;
	} else throw new Error(`未知命令：${command}`);
}
main().catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
