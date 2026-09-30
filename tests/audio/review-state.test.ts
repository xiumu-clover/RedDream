import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { voiceAnnotationHash } from '../../scripts/audio/audio-blocks.js';
import { createDoubaoDemoReviewSource } from '../../scripts/audio/review-source.js';
import {
	applyReviewAction,
	applyDefaultApprovalPolicy,
	createPolicyDocument,
	createReviewPlan,
	deriveProductionDocuments,
	resolveCachePath,
	saveReviewAction,
	syncSceneProduction,
} from '../../scripts/audio/review-state.js';

function target(overrides = {}) {
	return {
		targetId: 'dialogue:081-b0042:u01', kind: 'dialogue_fragment', blockId: '081-b0042', unitIndex: 0,
		blockText: '原文', unitText: '原文', context: null, speakerRef: 'xiren', annotationSnapshot: {},
		annotationHash: 'annotation-a', voiceCard: { id: 'xiren:test', fileHash: 'card-a' },
		audio: { cachePath: 'content/audio/.cache/test.wav', renderHash: 'render-a', fileHash: 'file-a' },
		automaticCheck: { structuralPass: true }, technicalIssues: [],
		milestones: { planned: true, rendered: true, autoPassed: true }, reviewState: 'pending_review',
		...overrides,
	};
}

function source(overrides = {}) {
	return { version: 1, chapter: '081', scene: 'xiren-three-opera', source: { path: 'content/chapters/081.md', fileHash: 'source' }, annotationSetHash: 'set-a', narration: { total: 1, rendered: 1, autoPassed: 1, allAutoPassed: true }, targets: [target()], ...overrides };
}

test('豆包审核源只把当前哈希且机器通过的片段送入人工待审', () => {
	const annotation = {
		speakerRef: 'xiren',
		emotion: { family: 'anger', variant: 'defensive-indignation', intensity: 2 },
		pace: 'medium', pitch: 'medium', energy: 'medium', timbre: ['firm'], modifiers: [],
	};
	const annotationHash = voiceAnnotationHash(annotation);
	const scenePlan = {
		chapter: '081', scene: 'xiren-three-opera', source: { path: 'content/chapters/081.md', fileHash: 'source' },
		counts: { narrationBlocks: 2 },
		voiceCards: { 'xiren:test': { path: 'content/audio/.cache/card.wav', fileHash: 'card-hash', text: '参考文本' } },
		dialogueBlocks: [{ blockId: '081-b1', text: '第一句。第二句。', annotationHash, annotationSnapshot: annotation, context: null }],
		dialogueUnits: [
			{ targetId: 'dialogue:081-b1:u01', blockId: '081-b1', unitIndex: 0, text: '第一句。', synthesisText: '第一句。', speakerRef: 'xiren', annotationHash, voiceCardId: 'xiren:test', voiceCardFileHash: 'card-hash', instruction: '忍怒自辩', speed: 1 },
			{ targetId: 'dialogue:081-b1:u02', blockId: '081-b1', unitIndex: 1, text: '第二句。', synthesisText: '第二句。', speakerRef: 'xiren', annotationHash, voiceCardId: 'xiren:test', voiceCardFileHash: 'card-hash', instruction: '忍怒自辩', speed: 1 },
		],
	};
	const result = createDoubaoDemoReviewSource({
		scenePlan,
		demoManifest: {
			chapter: '081', scene: 'xiren-three-opera',
			fragments: [{
				targetId: 'dialogue:081-b1:u01', blockId: '081-b1', unitIndex: 0,
				annotationHash, voiceCardId: 'xiren:test', voiceCardFileHash: 'card-hash',
				subtitleExact: true, subtitleText: '第一句。', synthesisHash: 'a'.repeat(64),
				path: 'content/audio/.cache/doubao/first.wav', fileHash: 'b'.repeat(64), durationSeconds: 1.2,
			}],
		},
		whisperValidation: {
			results: [{ id: 'dialogue:081-b1:u01', transcript: '第一句。', status: 'exact', characterSimilarity: 1, lengthRatio: 1 }],
			selectionReview: { results: [{ id: 'dialogue:081-b1:u01', structuralPass: true, rawStatus: 'exact', characterSimilarity: 1, lengthRatio: 1 }] },
		},
		annotationDocument: { annotations: { '081-b1': annotation } },
	});
	assert.equal(result.targets.length, 2);
	assert.equal(result.targets[0].reviewState, 'pending_review');
	assert.equal(result.targets[0].audio.fileHash, 'b'.repeat(64));
	assert.equal(result.targets[1].reviewState, 'planned');
	assert.equal(result.targets[1].audio, null);
});

async function fixture() {
	const root = await mkdtemp(join(tmpdir(), 'audio-review-'));
	const policyPath = join(root, 'content', 'audio', 'production', 'policy.json');
	await mkdir(join(policyPath, '..'), { recursive: true });
	await writeFile(policyPath, `${JSON.stringify(createPolicyDocument(), null, 2)}\n`);
	return root;
}

test('未试听保持 pending_review，机器检查不会产生人工 approved', () => {
	const plan = createReviewPlan(source());
	const approvals = { version: 1, chapter: '081', scene: 'xiren-three-opera', reviewer: 'project-owner', records: [{ reviewKey: plan.targets[0].reviewKey, targetId: plan.targets[0].targetId, status: 'pending_review', binding: {}, note: '', history: [] }] };
	const derived = deriveProductionDocuments(plan, approvals, createPolicyDocument());
	assert.equal(derived.status.counts.byStatus.pending_review, 1);
	assert.equal(derived.status.counts.byStatus.rejected, 0);
	assert.equal(derived.status.gates.dialogueApproved, false);
});

test('项目所有者授权后，豆包当前哈希通过机器检查即按策略默认批准', () => {
	const plan = createReviewPlan(source({ targets: [target({ provider: 'doubao' })] }));
	const approvals = {
		version: 1,
		chapter: '081',
		scene: 'xiren-three-opera',
		reviewer: 'project-owner',
		records: [{
			reviewKey: plan.targets[0].reviewKey,
			targetId: plan.targets[0].targetId,
			status: 'pending_review',
			binding: {},
			note: '',
			history: [],
		}],
	};
	applyDefaultApprovalPolicy(plan, approvals, createPolicyDocument(), '2026-09-22T10:00:00+08:00');
	assert.equal(approvals.records[0].status, 'approved');
	assert.equal(approvals.records[0].history[0].source, 'project-owner-default-policy');
	applyDefaultApprovalPolicy(plan, approvals, createPolicyDocument(), '2026-09-22T10:01:00+08:00');
	assert.equal(approvals.records[0].history.length, 1);
});

test('默认批准策略不会越过自动检查，也不会覆盖用户拒绝', () => {
	const failedPlan = createReviewPlan(source({ targets: [target({
		provider: 'doubao',
		milestones: { planned: true, rendered: true, autoPassed: false },
		reviewState: 'rendered',
	})] }));
	const failedApprovals = {
		version: 1, chapter: '081', scene: 'xiren-three-opera', reviewer: 'project-owner',
		records: [{ reviewKey: failedPlan.targets[0].reviewKey, targetId: failedPlan.targets[0].targetId, status: 'rendered', binding: {}, note: '', history: [] }],
	};
	applyDefaultApprovalPolicy(failedPlan, failedApprovals, createPolicyDocument());
	assert.equal(failedApprovals.records[0].status, 'rendered');

	const passedPlan = createReviewPlan(source({ targets: [target({ provider: 'doubao' })] }));
	const rejectedApprovals = {
		version: 1, chapter: '081', scene: 'xiren-three-opera', reviewer: 'project-owner',
		records: [{ reviewKey: passedPlan.targets[0].reviewKey, targetId: passedPlan.targets[0].targetId, status: 'rejected', binding: {}, note: '需重录', history: [{ action: 'rerecord', at: '2026-09-22T10:00:00+08:00', reviewer: 'project-owner' }] }],
	};
	applyDefaultApprovalPolicy(passedPlan, rejectedApprovals, createPolicyDocument());
	assert.equal(rejectedApprovals.records[0].status, 'rejected');
});

test('审批、拒绝、重录和备注原子保存，重复动作幂等且工作单只列失败', async () => {
	const root = await fixture();
	const initial = await syncSceneProduction({ projectRoot: root, reviewSource: source(), now: '2026-09-14T10:00:00+08:00' });
	const key = initial.plan.targets[0].reviewKey;
	await saveReviewAction({ projectRoot: root, chapter: '081', scene: 'xiren-three-opera', planHash: initial.plan.planHash, reviewKey: key, action: 'approve', now: '2026-09-14T10:01:00+08:00' });
	await saveReviewAction({ projectRoot: root, chapter: '081', scene: 'xiren-three-opera', planHash: initial.plan.planHash, reviewKey: key, action: 'approve', now: '2026-09-14T10:02:00+08:00' });
	let approvals = JSON.parse(await readFile(initial.paths.approvals, 'utf8'));
	assert.equal(approvals.records[0].history.length, 1);
	await saveReviewAction({ projectRoot: root, chapter: '081', scene: 'xiren-three-opera', planHash: initial.plan.planHash, reviewKey: key, action: 'rerecord', issueType: 'performance', note: '力度太满', expectedEffect: '收住怒意，保持清楚。', now: '2026-09-14T10:03:00+08:00' });
	await saveReviewAction({ projectRoot: root, chapter: '081', scene: 'xiren-three-opera', planHash: initial.plan.planHash, reviewKey: key, action: 'note', note: '定位在第二句', now: '2026-09-14T10:04:00+08:00' });
	const order = JSON.parse(await readFile(initial.paths.workOrders.recording, 'utf8'));
	assert.equal(order.failures.length, 1);
	assert.equal(order.failures[0].requestedAction, 'rerecord');
	assert.equal(order.failures[0].expectedEffect, '收住怒意，保持清楚。');
	assert.equal(order.failures[0].note, '定位在第二句');
	assert.equal(Object.hasOwn(order, 'approved'), false);
	assert.equal((await readFile(initial.paths.approvals, 'utf8')).includes('.tmp'), false);
});

test('云端 decisionId 重试不会重复写入审批历史', async () => {
	const root = await fixture();
	const initial = await syncSceneProduction({ projectRoot: root, reviewSource: source(), now: '2026-09-17T10:00:00+08:00' });
	const action = {
		projectRoot: root,
		chapter: '081',
		scene: 'xiren-three-opera',
		planHash: initial.plan.planHash,
		reviewKey: initial.plan.targets[0].reviewKey,
		action: 'approve',
		decisionId: 'cloud-decision-123456',
	};
	await saveReviewAction({ ...action, now: '2026-09-17T10:01:00+08:00' });
	await saveReviewAction({ ...action, now: '2026-09-17T10:02:00+08:00' });
	const approvals = JSON.parse(await readFile(initial.paths.approvals, 'utf8'));
	assert.equal(approvals.records[0].history.length, 1);
	assert.equal(approvals.records[0].history[0].decisionId, action.decisionId);
});

test('任一绑定哈希变化会 supersede 旧审批并阻止过期页面写入', async () => {
	const root = await fixture();
	const first = await syncSceneProduction({ projectRoot: root, reviewSource: source(), now: '2026-09-14T10:00:00+08:00' });
	await saveReviewAction({ projectRoot: root, chapter: '081', scene: 'xiren-three-opera', planHash: first.plan.planHash, reviewKey: first.plan.targets[0].reviewKey, action: 'approve', now: '2026-09-14T10:01:00+08:00' });
	const second = await syncSceneProduction({ projectRoot: root, reviewSource: source({ targets: [target({ audio: { cachePath: 'content/audio/.cache/test.wav', renderHash: 'render-b', fileHash: 'file-b' } })] }), now: '2026-09-14T10:02:00+08:00' });
	assert.equal(second.approvals.records.find((record) => record.reviewKey === first.plan.targets[0].reviewKey).status, 'superseded');
	assert.equal(second.approvals.records.find((record) => record.reviewKey === second.plan.targets[0].reviewKey).status, 'pending_review');
	await assert.rejects(() => saveReviewAction({ projectRoot: root, chapter: '081', scene: 'xiren-three-opera', planHash: first.plan.planHash, reviewKey: first.plan.targets[0].reviewKey, action: 'approve' }), /已经更新/);
});

test('标注、音色卡、renderHash 和 fileHash 分别参与精确审批绑定', () => {
	const original = createReviewPlan(source()).targets[0].reviewKey;
	const variants = [
		target({ annotationHash: 'annotation-b' }),
		target({ voiceCard: { id: 'xiren:test', fileHash: 'card-b' } }),
		target({ audio: { cachePath: 'content/audio/.cache/test.wav', renderHash: 'render-b', fileHash: 'file-a' } }),
		target({ audio: { cachePath: 'content/audio/.cache/test.wav', renderHash: 'render-a', fileHash: 'file-b' } }),
	];
	for (const changed of variants) {
		assert.notEqual(createReviewPlan(source({ targets: [changed] })).targets[0].reviewKey, original);
	}
});

test('自动检查未通过的片段不能人工批准，旁白技术通过仍需对白审批和整场试听', () => {
	const reviewSource = source({ targets: [target({ milestones: { planned: true, rendered: true, autoPassed: false }, reviewState: 'rendered' })] });
	const plan = createReviewPlan(reviewSource);
	const approvals = { version: 1, chapter: '081', scene: 'xiren-three-opera', reviewer: 'project-owner', records: [{ reviewKey: plan.targets[0].reviewKey, targetId: plan.targets[0].targetId, status: 'rendered', binding: {}, note: '', history: [] }] };
	assert.throws(() => applyReviewAction({ plan, approvals, planHash: plan.planHash, reviewKey: plan.targets[0].reviewKey, action: 'approve' }), /自动技术检查/);
	const derived = deriveProductionDocuments(plan, approvals, createPolicyDocument());
	assert.equal(derived.status.gates.narrationTechnicalPassed, true);
	assert.equal(derived.status.gates.formalSceneCompositionAllowed, false);
	assert.equal(derived.status.gates.sceneApproved, false);
});

test('试听路径只接受仓库内两个音频缓存目录', () => {
	const root = 'G:\\红楼\\Code';
	assert.match(resolveCachePath(root, 'content/audio/.cache/a.wav'), /content[\\/]audio[\\/]\.cache/);
	assert.match(resolveCachePath(root, 'content/audio.cache/a.wav'), /content[\\/]audio\.cache/);
	assert.throws(() => resolveCachePath(root, '../secret.wav'));
	assert.throws(() => resolveCachePath(root, 'public/audio/book.mp3'));
	assert.throws(() => resolveCachePath(root, 'content/audio/.cache/../config.json'));
});
