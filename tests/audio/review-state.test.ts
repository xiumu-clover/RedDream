import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import {
	applyReviewAction,
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

test('任一绑定哈希变化会 supersede 旧审批并阻止过期页面写入', async () => {
	const root = await fixture();
	const first = await syncSceneProduction({ projectRoot: root, reviewSource: source(), now: '2026-09-14T10:00:00+08:00' });
	await saveReviewAction({ projectRoot: root, chapter: '081', scene: 'xiren-three-opera', planHash: first.plan.planHash, reviewKey: first.plan.targets[0].reviewKey, action: 'approve', now: '2026-09-14T10:01:00+08:00' });
	const second = await syncSceneProduction({ projectRoot: root, reviewSource: source({ targets: [target({ audio: { cachePath: 'content/audio/.cache/test.wav', renderHash: 'render-b', fileHash: 'file-b' } })] }), now: '2026-09-14T10:02:00+08:00' });
	assert.equal(second.approvals.records.find((record) => record.reviewKey === first.plan.targets[0].reviewKey).status, 'superseded');
	assert.equal(second.approvals.records.find((record) => record.reviewKey === second.plan.targets[0].reviewKey).status, 'pending_review');
	await assert.rejects(() => saveReviewAction({ projectRoot: root, chapter: '081', scene: 'xiren-three-opera', planHash: first.plan.planHash, reviewKey: first.plan.targets[0].reviewKey, action: 'approve' }), /已经更新/);
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
