import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { auditPreparedInputs } from './audit.js';
import { DEFAULT_PATHS, STYLE_AUDIT_SEED } from './constants.js';
import { prepareAuditInputs, prepareReferenceCorpus } from './corpus.js';
import { trainStyleAuditModel } from './model.js';
import { buildReferenceAnalysis, renderReferenceAnalysis } from './reference-analysis.js';
import { renderMarkdownReport } from './report.js';

function parseArguments(argv) {
	const command = argv[0];
	const options = { _: [] };
	for (let index = 1; index < argv.length; index += 1) {
		const argument = argv[index];
		if (!argument.startsWith('--')) {
			options._.push(argument);
			continue;
		}
		const key = argument.slice(2);
		const next = argv[index + 1];
		if (!next || next.startsWith('--')) options[key] = true;
		else {
			options[key] = next;
			index += 1;
		}
	}
	return { command, options };
}

async function readJson(path) {
	return JSON.parse(await readFile(path, 'utf8'));
}

async function writeText(path, value) {
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, value, 'utf8');
}

async function writeJson(path, value, pretty = true) {
	await writeText(path, `${JSON.stringify(value, null, pretty ? 2 : 0)}\n`);
}

function absolute(projectRoot, path) {
	return resolve(projectRoot, path);
}

function printUsage() {
	process.stdout.write(`文风相容度审验工具\n\n` +
		`  prepare [--output PATH] [--seed NUMBER]\n` +
		`  train   [--corpus PATH] [--output PATH]\n` +
		`  audit   --input FILE_OR_DIR [--model PATH] [--output PATH] [--neural-results PATH]\n` +
		`  report  [--input PATH] [--output PATH]\n` +
		`  reference-report [--corpus PATH] [--model PATH] [--json PATH] [--output PATH]\n`);
}

async function main() {
	const { command, options } = parseArguments(process.argv.slice(2));
	const projectRoot = process.cwd();
	if (!command || options.help) {
		printUsage();
		return;
	}

	if (command === 'prepare') {
		const output = absolute(projectRoot, options.output ?? DEFAULT_PATHS.corpus);
		const seed = Number(options.seed ?? STYLE_AUDIT_SEED);
		if (!Number.isInteger(seed)) throw new Error('--seed 必须是整数。');
		const corpus = await prepareReferenceCorpus(projectRoot, { seed });
		await writeJson(output, corpus);
		const prose = corpus.fragments.filter((fragment) => fragment.track === 'prose');
		process.stdout.write(`已生成参考语料：${output}\n` +
			`训练/校准/测试片段：${['training', 'calibration', 'test'].map((split) => prose.filter((fragment) => fragment.split === split).length).join('/')}\n` +
			`corpusHash=${corpus.corpusHash}\n`);
		return;
	}

	if (command === 'train') {
		const corpusPath = absolute(projectRoot, options.corpus ?? DEFAULT_PATHS.corpus);
		const output = absolute(projectRoot, options.output ?? DEFAULT_PATHS.model);
		const corpus = await readJson(corpusPath);
		const model = trainStyleAuditModel(corpus);
		await writeJson(output, model, false);
		process.stdout.write(`已生成基准模型：${output}\n` +
			`状态=${model.validation.status}\n` +
			`冻结测试章节误报率=${(model.validation.falseOutlierRate * 100).toFixed(1)}%\n` +
			`modelHash=${model.modelHash}\n`);
		return;
	}

	if (command === 'audit') {
		const inputPath = options.input ?? options._[0];
		if (!inputPath) throw new Error('audit 必须提供 --input FILE_OR_DIR。');
		const modelPath = absolute(projectRoot, options.model ?? DEFAULT_PATHS.model);
		const output = absolute(projectRoot, options.output ?? DEFAULT_PATHS.audit);
		const model = await readJson(modelPath);
		const inputs = await prepareAuditInputs(absolute(projectRoot, inputPath), model);
		const neuralResults = options['neural-results']
			? await readJson(absolute(projectRoot, options['neural-results']))
			: null;
		const result = auditPreparedInputs(inputs, model, neuralResults);
		await writeJson(output, result);
		process.stdout.write(`已生成审验结果：${output}\n` +
			result.inputs.map((input) => `${input.id}\t${input.aggregate.overall?.toFixed(1) ?? '不稳定'}\t${input.aggregate.band}`).join('\n') + '\n');
		return;
	}

	if (command === 'report') {
		const input = absolute(projectRoot, options.input ?? DEFAULT_PATHS.audit);
		const output = absolute(projectRoot, options.output ?? DEFAULT_PATHS.report);
		const result = await readJson(input);
		await writeText(output, renderMarkdownReport(result));
		process.stdout.write(`已生成审稿报告：${output}\n`);
		return;
	}

	if (command === 'reference-report') {
		const corpusPath = absolute(projectRoot, options.corpus ?? DEFAULT_PATHS.corpus);
		const modelPath = absolute(projectRoot, options.model ?? DEFAULT_PATHS.model);
		const jsonOutput = absolute(projectRoot, options.json ?? DEFAULT_PATHS.referenceAnalysis);
		const markdownOutput = absolute(projectRoot, options.output ?? DEFAULT_PATHS.referenceReport);
		const corpus = await readJson(corpusPath);
		const model = await readJson(modelPath);
		const result = buildReferenceAnalysis(corpus, model);
		await writeJson(jsonOutput, result);
		await writeText(markdownOutput, renderReferenceAnalysis(result));
		process.stdout.write(`已生成前八十回逐回分析：${jsonOutput}\n` +
			`已生成前八十回基准报告：${markdownOutput}\n` +
			`参考范围内/偏弱/显著异常=${result.summary.bands['参考范围内']}/${result.summary.bands['偏弱']}/${result.summary.bands['显著异常']}\n` +
			`探索性最优类别=${result.exploratoryClustering.selectedClusterCount}，silhouette=${result.exploratoryClustering.selectedSilhouette.toFixed(3)}\n`);
		return;
	}

	throw new Error(`未知命令：${command}`);
}

main().catch((error) => {
	process.stderr.write(`${error.stack ?? error.message}\n`);
	process.exitCode = 1;
});
