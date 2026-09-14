import { readFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { hashJson, stableStringify } from './audio-blocks.js';
import { readJsonIfExists, writeJsonAtomic } from './files.js';

export const PRODUCTION_SCHEMA_VERSION = 1;
export const REVIEW_STATUSES = [
	'planned',
	'rendered',
	'auto_passed',
	'pending_review',
	'approved',
	'rejected',
	'superseded',
];

export const ISSUE_TYPES = {
	speaker: { label: '人物不对', route: 'annotation' },
	text_alignment: { label: '正文对应不对', route: 'annotation' },
	emotion_design: { label: '情绪方向不对', route: 'annotation' },
	pronunciation_rule: { label: '读音规则不对', route: 'annotation' },
	segmentation_design: { label: '断句设计不对', route: 'annotation' },
	voice_identity: { label: '音色身份不合适', route: 'voice-cards' },
	voice_age_texture: { label: '年龄或质感不合适', route: 'voice-cards' },
	voice_drift: { label: '声纹漂移', route: 'voice-cards' },
	reference_noise: { label: '参考音底噪或污染', route: 'voice-cards' },
	performance: { label: '表演力度不对', route: 'recording' },
	pace_execution: { label: '语速执行不对', route: 'recording' },
	pause: { label: '停顿不自然', route: 'recording' },
	missing_words: { label: '漏字', route: 'recording' },
	repetition: { label: '重复或回卷', route: 'recording' },
	tail_or_cutoff: { label: '拖尾或截尾', route: 'recording' },
	level: { label: '音量或响度问题', route: 'recording' },
	clipping: { label: '爆音或削波', route: 'recording' },
	other: { label: '其他，交总控判断', route: 'manager' },
};

export function createPolicyDocument() {
	return {
		version: PRODUCTION_SCHEMA_VERSION,
		reviewer: 'project-owner',
		statuses: REVIEW_STATUSES,
		approvalBinding: [
			'targetId', 'blockId', 'unitIndex', 'annotationHash', 'voiceCardId',
			'voiceCardFileHash', 'renderHash', 'fileHash',
		],
		gates: {
			dialogue: '每个当前对白实际入片单元必须由用户 approved。',
			narration: '旁白通过技术检查后可暂定进入场景，但仍须随整场完成人工验收。',
			scene: '全部当前对白 approved 且旁白技术通过后，才允许正式场景合成。',
			chapter: '整章仍须从头到尾人工试听并绑定最终整轨哈希。',
		},
		issueTypes: ISSUE_TYPES,
		workOrderPolicy: {
			recording: '只处理 failures 中列出的目标，禁止重做其他已批准片段。',
			annotation: '只修改明确列出的派生语义标注，不修改小说正文。',
			'voice-cards': '只处理明确列出的音色问题，不直接批准对白片段。',
		},
	};
}

export function productionPaths(projectRoot, chapter, scene) {
	const root = join(projectRoot, 'content', 'audio', 'production');
	const chapterDirectory = join(root, 'chapters', chapter);
	const workOrderDirectory = join(root, 'work-orders', chapter, scene);
	return {
		root,
		policy: join(root, 'policy.json'),
		plan: join(chapterDirectory, 'plan.json'),
		approvals: join(chapterDirectory, 'approvals.json'),
		status: join(chapterDirectory, 'status.json'),
		workOrders: {
			recording: join(workOrderDirectory, 'recording.json'),
			annotation: join(workOrderDirectory, 'annotation.json'),
			'voice-cards': join(workOrderDirectory, 'voice-cards.json'),
		},
	};
}

function compactBinding(target) {
	return {
		targetId: target.targetId,
		kind: target.kind,
		blockId: target.blockId ?? null,
		unitIndex: target.unitIndex ?? null,
		annotationHash: target.annotationHash ?? null,
		voiceCardId: target.voiceCard?.id ?? null,
		voiceCardFileHash: target.voiceCard?.fileHash ?? null,
		renderHash: target.audio?.renderHash ?? null,
		fileHash: target.audio?.fileHash ?? null,
	};
}

export function reviewKeyForTarget(target) {
	return hashJson({ version: PRODUCTION_SCHEMA_VERSION, ...compactBinding(target) });
}

function normalizeTarget(target) {
	const value = {
		...target,
		reviewKey: reviewKeyForTarget(target),
	};
	if (!REVIEW_STATUSES.includes(value.reviewState)
		|| ['approved', 'rejected', 'superseded'].includes(value.reviewState)) {
		throw new Error(`审核目标 ${target.targetId} 的初始状态 ${target.reviewState} 无效。`);
	}
	return value;
}

export function createReviewPlan(reviewSource) {
	const targets = reviewSource.targets.map(normalizeTarget);
	const ids = new Set();
	for (const target of targets) {
		if (!target.targetId || ids.has(target.targetId)) {
			throw new Error(`审核目标 ID 缺失或重复：${target.targetId}`);
		}
		ids.add(target.targetId);
	}
	const stable = {
		version: PRODUCTION_SCHEMA_VERSION,
		chapter: reviewSource.chapter,
		scene: reviewSource.scene,
		source: reviewSource.source,
		annotationSetHash: reviewSource.annotationSetHash,
		narration: reviewSource.narration,
		targets,
	};
	return { ...stable, planHash: hashJson(stable) };
}

function initialRecord(target, now) {
	return {
		reviewKey: target.reviewKey,
		targetId: target.targetId,
		kind: target.kind,
		status: target.reviewState,
		binding: compactBinding(target),
		note: '',
		history: [],
		createdAt: now,
	};
}

export function reconcileApprovals(plan, previous, now = new Date().toISOString()) {
	const document = previous && previous.version === PRODUCTION_SCHEMA_VERSION
		? structuredClone(previous)
		: {
			version: PRODUCTION_SCHEMA_VERSION,
			chapter: plan.chapter,
			scene: plan.scene,
			reviewer: 'project-owner',
			records: [],
		};
	if (document.chapter !== plan.chapter || document.scene !== plan.scene
		|| !Array.isArray(document.records)) {
		throw new Error('approvals.json 的回目、场景或 records 格式无效。');
	}
	const currentByTarget = new Map(plan.targets.map((target) => [target.targetId, target]));
	for (const record of document.records) {
		const current = currentByTarget.get(record.targetId);
		if (record.status !== 'superseded'
			&& (!current || record.reviewKey !== current.reviewKey)) {
			record.statusBeforeSuperseded = record.status;
			record.status = 'superseded';
			record.supersededAt = now;
			record.supersededBy = current?.reviewKey ?? null;
		}
	}
	for (const target of plan.targets) {
		let record = document.records.find((item) => item.reviewKey === target.reviewKey);
		if (!record) {
			record = initialRecord(target, now);
			document.records.push(record);
			continue;
		}
		if (record.status === 'superseded') {
			record.status = record.statusBeforeSuperseded || target.reviewState;
			delete record.statusBeforeSuperseded;
			delete record.supersededAt;
			delete record.supersededBy;
		}
		if (['planned', 'rendered', 'auto_passed', 'pending_review'].includes(record.status)
			&& record.status !== target.reviewState) {
			record.status = target.reviewState;
		}
		record.binding = compactBinding(target);
	}
	return document;
}

function currentRecordMap(plan, approvals) {
	return new Map(plan.targets.map((target) => [
		target.reviewKey,
		approvals.records.find((record) => record.reviewKey === target.reviewKey),
	]));
}

function effectiveStatus(target, record) {
	return record?.status || target.reviewState;
}

function latestDecision(record) {
	return Array.isArray(record?.history) ? record.history.at(-1) : undefined;
}

export function deriveProductionDocuments(plan, approvals, policy) {
	const records = currentRecordMap(plan, approvals);
	const dialogue = plan.targets.filter((target) => target.kind === 'dialogue_fragment');
	const scene = plan.targets.find((target) => target.kind === 'scene_mix');
	const counts = Object.fromEntries(REVIEW_STATUSES.map((status) => [status, 0]));
	for (const target of plan.targets) counts[effectiveStatus(target, records.get(target.reviewKey))] += 1;
	const dialogueApproved = dialogue.length > 0 && dialogue.every((target) => (
		effectiveStatus(target, records.get(target.reviewKey)) === 'approved'
		&& target.milestones?.autoPassed === true
	));
	const narrationTechnicalPassed = plan.narration?.allAutoPassed === true;
	const formalSceneCompositionAllowed = dialogueApproved && narrationTechnicalPassed;
	const sceneApproved = Boolean(scene
		&& effectiveStatus(scene, records.get(scene.reviewKey)) === 'approved');
	const remainingReviewCount = dialogue.filter((target) => (
		effectiveStatus(target, records.get(target.reviewKey)) !== 'approved'
	)).length;
	const blockers = [];
	if (!narrationTechnicalPassed) blockers.push('旁白仍有未完成或过期的技术检查。');
	if (!dialogueApproved) blockers.push(`还有 ${remainingReviewCount} 个当前对白单元未批准。`);
	if (formalSceneCompositionAllowed && !scene) blockers.push('对白门禁已通过，尚未生成当前正式场景。');
	if (scene && !sceneApproved) blockers.push('当前正式场景尚未完成整场人工试听。');

	const status = {
		version: PRODUCTION_SCHEMA_VERSION,
		chapter: plan.chapter,
		scene: plan.scene,
		planHash: plan.planHash,
		counts: {
			totalTargets: plan.targets.length,
			dialogueTargets: dialogue.length,
			remainingReviewCount,
			byStatus: counts,
		},
		narration: plan.narration,
		gates: {
			dialogueApproved,
			narrationTechnicalPassed,
			formalSceneCompositionAllowed,
			sceneApproved,
		},
		blockers,
	};

	const failuresByRoute = { recording: [], annotation: [], 'voice-cards': [] };
	const managerFailures = [];
	for (const target of [...dialogue, ...(scene ? [scene] : [])]) {
		const record = records.get(target.reviewKey);
		if (record?.status === 'rejected') {
			const route = ISSUE_TYPES[record.issueType]?.route || 'manager';
			const failure = {
				targetId: target.targetId,
				reviewKey: target.reviewKey,
				blockId: target.blockId,
				unitIndex: target.unitIndex,
				text: target.unitText,
				speakerRef: target.speakerRef,
				binding: compactBinding(target),
				requestedAction: record.lastDecisionAction,
				issueType: record.issueType,
				issueLabel: ISSUE_TYPES[record.issueType]?.label,
				note: record.note,
				expectedEffect: record.expectedEffect,
				decidedAt: record.lastDecisionAt,
			};
			if (route === 'manager') managerFailures.push(failure);
			else failuresByRoute[route].push(failure);
		}
		if (target.reviewState === 'rendered' && target.technicalIssues?.length) {
			failuresByRoute.recording.push({
				targetId: target.targetId,
				reviewKey: target.reviewKey,
				blockId: target.blockId,
				unitIndex: target.unitIndex,
				text: target.unitText,
				speakerRef: target.speakerRef,
				binding: compactBinding(target),
				requestedAction: 'fix-technical-check',
				issueType: 'automatic-check',
				note: target.technicalIssues.join('；'),
				expectedEffect: '修复客观技术问题后重新生成，并交回人工试听。',
			});
		}
		if (target.kind === 'dialogue_fragment' && target.reviewState === 'planned') {
			failuresByRoute.recording.push({
				targetId: target.targetId,
				reviewKey: target.reviewKey,
				blockId: target.blockId,
				unitIndex: target.unitIndex,
				text: target.unitText,
				speakerRef: target.speakerRef,
				binding: compactBinding(target),
				requestedAction: 'render-current-binding',
				issueType: 'missing-current-render',
				note: '当前标注、分句、音色卡或渲染绑定没有可复用的实际入片文件。',
				expectedEffect: '只生成这个当前绑定版本，完成机器检查后交回人工试听。',
			});
		}
	}
	if (managerFailures.length > 0) status.managerTriage = managerFailures;

	const workOrders = Object.fromEntries(Object.entries(failuresByRoute).map(([route, failures]) => [
		route,
		{
			version: PRODUCTION_SCHEMA_VERSION,
			chapter: plan.chapter,
			scene: plan.scene,
			planHash: plan.planHash,
			assignedTo: route,
			remainingReviewCount,
			instructions: policy.workOrderPolicy?.[route],
			failures,
		},
	]));
	return { status, workOrders };
}

function comparable(value) {
	return stableStringify(value);
}

async function writeJsonIfChanged(path, value) {
	const current = await readJsonIfExists(path);
	if (current && comparable(current) === comparable(value)) return false;
	await writeJsonAtomic(path, value);
	return true;
}

async function loadPolicy(path) {
	const policy = await readJsonIfExists(path);
	if (!policy || policy.version !== PRODUCTION_SCHEMA_VERSION
		|| !policy.issueTypes || !policy.workOrderPolicy) {
		throw new Error('缺少或无法识别 content/audio/production/policy.json。');
	}
	return policy;
}

export async function syncSceneProduction({
	projectRoot,
	reviewSource,
	now = new Date().toISOString(),
}) {
	const paths = productionPaths(projectRoot, reviewSource.chapter, reviewSource.scene);
	const policy = await loadPolicy(paths.policy);
	const plan = createReviewPlan(reviewSource);
	const previousApprovals = await readJsonIfExists(paths.approvals);
	const approvals = reconcileApprovals(plan, previousApprovals, now);
	const derived = deriveProductionDocuments(plan, approvals, policy);
	const changed = {
		plan: await writeJsonIfChanged(paths.plan, plan),
		approvals: await writeJsonIfChanged(paths.approvals, approvals),
		status: await writeJsonIfChanged(paths.status, derived.status),
		workOrders: {},
	};
	for (const [route, document] of Object.entries(derived.workOrders)) {
		changed.workOrders[route] = await writeJsonIfChanged(paths.workOrders[route], document);
	}
	return { paths, policy, plan, approvals, ...derived, changed };
}

export async function loadProductionBundle(projectRoot, chapter, scene) {
	const paths = productionPaths(projectRoot, chapter, scene);
	const [policy, plan, approvals, status] = await Promise.all([
		readJsonIfExists(paths.policy),
		readJsonIfExists(paths.plan),
		readJsonIfExists(paths.approvals),
		readJsonIfExists(paths.status),
	]);
	if (!policy || !plan || !approvals || !status) {
		throw new Error('审核状态尚未初始化，请先运行场景草稿或审核台同步。');
	}
	return { paths, policy, plan, approvals, status };
}

export function applyReviewAction({
	plan,
	approvals,
	planHash,
	reviewKey,
	action,
	issueType,
	note = '',
	expectedEffect = '',
	now = new Date().toISOString(),
}) {
	if (planHash !== plan.planHash) {
		const error = new Error('审核计划已经更新，请刷新后再操作。');
		error.code = 'STALE_PLAN';
		throw error;
	}
	const target = plan.targets.find((item) => item.reviewKey === reviewKey);
	const record = approvals.records.find((item) => item.reviewKey === reviewKey);
	if (!target || !record || record.status === 'superseded') {
		const error = new Error('该片段已被新版本取代，请刷新后审核当前版本。');
		error.code = 'STALE_TARGET';
		throw error;
	}
	if (!['approve', 'reject', 'rerecord', 'note'].includes(action)) {
		throw new Error(`不支持审核动作 ${action}。`);
	}
	const cleanNote = String(note).trim();
	const cleanExpected = String(expectedEffect).trim();
	if (cleanNote.length > 4000 || cleanExpected.length > 4000) {
		throw new Error('备注和期望效果均不能超过 4000 个字符。');
	}
	if (action !== 'note' && !target.audio?.fileHash) {
		throw new Error('当前目标没有可播放且绑定哈希的音频，不能审批。');
	}
	if (action === 'approve' && target.milestones?.autoPassed !== true) {
		throw new Error('当前片段尚未通过自动技术检查，不能人工批准。');
	}
	if (['reject', 'rerecord'].includes(action)) {
		if (!ISSUE_TYPES[issueType]) throw new Error('拒绝或重录必须选择问题类型。');
		if (!cleanExpected) throw new Error('拒绝或重录必须填写期望效果。');
	}
	const event = {
		action,
		at: now,
		reviewer: approvals.reviewer || 'project-owner',
		...(issueType ? { issueType } : {}),
		...(cleanNote ? { note: cleanNote } : {}),
		...(cleanExpected ? { expectedEffect: cleanExpected } : {}),
	};
	const previous = latestDecision(record);
	const eventComparable = ({ at: _at, ...value }) => comparable(value);
	if (previous && eventComparable(previous) === eventComparable(event)) return approvals;
	record.history.push(event);
	record.note = cleanNote;
	if (action === 'approve') {
		record.status = 'approved';
		record.lastDecisionAction = action;
		record.lastDecisionAt = now;
	}
	if (action === 'reject' || action === 'rerecord') {
		record.status = 'rejected';
		record.issueType = issueType;
		record.expectedEffect = cleanExpected;
		record.lastDecisionAction = action;
		record.lastDecisionAt = now;
	}
	return approvals;
}

export async function saveReviewAction({ projectRoot, chapter, scene, ...action }) {
	const bundle = await loadProductionBundle(projectRoot, chapter, scene);
	const approvals = applyReviewAction({
		plan: bundle.plan,
		approvals: structuredClone(bundle.approvals),
		...action,
	});
	const derived = deriveProductionDocuments(bundle.plan, approvals, bundle.policy);
	await writeJsonIfChanged(bundle.paths.approvals, approvals);
	await writeJsonIfChanged(bundle.paths.status, derived.status);
	for (const [route, document] of Object.entries(derived.workOrders)) {
		await writeJsonIfChanged(bundle.paths.workOrders[route], document);
	}
	return { ...bundle, approvals, ...derived };
}

export function resolveCachePath(projectRoot, relativePath) {
	if (typeof relativePath !== 'string' || !relativePath || isAbsolute(relativePath)) {
		throw new Error('音频缓存路径必须是仓库相对路径。');
	}
	const normalized = relativePath.replaceAll('\\', '/');
	const allowedPrefixes = ['content/audio/.cache/', 'content/audio.cache/'];
	if (!allowedPrefixes.some((prefix) => normalized.startsWith(prefix))
		|| normalized.includes('/../') || normalized.endsWith('/..')) {
		throw new Error('音频路径不在允许的本地缓存目录内。');
	}
	const absolute = resolve(projectRoot, ...normalized.split('/'));
	const escaped = relative(projectRoot, absolute);
	if (escaped.startsWith('..') || isAbsolute(escaped)) throw new Error('音频路径越出项目目录。');
	return absolute;
}

export async function readJsonFile(path) {
	return JSON.parse(await readFile(path, 'utf8'));
}
