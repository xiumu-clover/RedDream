export const CLOUD_REVIEW_SCHEMA_VERSION = 1;
export const CLOUD_REVIEW_ACTIONS = ['approve', 'rerecord'];
export const MAX_REVIEW_NOTE_LENGTH = 1000;

const SPEAKER_LABELS = {
	'ai-guan': '艾官',
	'dou-guan': '荳官',
	'jia-baoyu': '贾宝玉',
	'kui-guan': '葵官',
	xiren: '袭人',
};

function cleanText(value, maximum = 20_000) {
	const text = String(value ?? '').trim();
	if (text.length > maximum) throw new Error(`文本超过允许长度 ${maximum}。`);
	return text;
}

function extensionForPath(path) {
	const match = /\.([a-z0-9]+)$/iu.exec(String(path || ''));
	return match?.[1]?.toLowerCase() || 'wav';
}

function contentTypeForExtension(extension) {
	return ({ wav: 'audio/wav', mp3: 'audio/mpeg', m4a: 'audio/mp4', ogg: 'audio/ogg', opus: 'audio/ogg' })[extension]
		|| 'application/octet-stream';
}

function currentRecords(bundle) {
	return new Map(bundle.approvals.records.map((record) => [record.reviewKey, record]));
}

export function buildCloudReviewBatch(bundle, publishedAt = new Date().toISOString()) {
	if (!bundle?.plan?.planHash || !Array.isArray(bundle.plan.targets) || !Array.isArray(bundle?.approvals?.records)) {
		throw new Error('本地审核计划或审批记录无效。');
	}
	const records = currentRecords(bundle);
	const uploads = [];
	const targets = [];
	for (const [ordinal, target] of bundle.plan.targets.entries()) {
		const record = records.get(target.reviewKey);
		if (!['dialogue_fragment', 'scene_mix'].includes(target.kind)
			|| record?.status !== 'pending_review') continue;
		if (!target.audio?.cachePath || !target.audio?.fileHash || !target.audio?.renderHash
			|| target.milestones?.autoPassed !== true) continue;
		const extension = extensionForPath(target.audio.cachePath);
		const objectKey = `review-audio/v${CLOUD_REVIEW_SCHEMA_VERSION}/${target.audio.fileHash}.${extension}`;
		targets.push({
			reviewKey: target.reviewKey,
			targetId: target.targetId,
			kind: target.kind,
			ordinal,
			blockId: target.blockId ?? null,
			unitIndex: target.unitIndex ?? null,
			speakerRef: cleanText(target.speakerRef, 200),
			speakerLabel: SPEAKER_LABELS[target.speakerRef] || cleanText(target.speakerRef, 200),
			blockText: cleanText(target.blockText),
			unitText: cleanText(target.unitText),
			context: target.context ?? null,
			binding: record.binding,
			audio: {
				objectKey,
				contentType: contentTypeForExtension(extension),
				fileHash: target.audio.fileHash,
				renderHash: target.audio.renderHash,
				durationSeconds: target.audio.durationSeconds ?? null,
			},
		});
		uploads.push({
			reviewKey: target.reviewKey,
			cachePath: target.audio.cachePath,
			objectKey,
			contentType: contentTypeForExtension(extension),
			fileHash: target.audio.fileHash,
		});
	}
	const manifest = {
		version: CLOUD_REVIEW_SCHEMA_VERSION,
		chapter: bundle.plan.chapter,
		scene: bundle.plan.scene,
		planHash: bundle.plan.planHash,
		publishedAt,
		summary: {
			dialogueTargets: bundle.status.counts.dialogueTargets,
			remainingReviewCount: bundle.status.counts.remainingReviewCount,
			alreadyApproved: bundle.status.counts.byStatus.approved || 0,
			waitingForRender: bundle.status.counts.byStatus.planned || 0,
			playableReviewCount: targets.length,
		},
		targets,
	};
	return { manifest, uploads };
}

export function validateReviewManifest(manifest) {
	if (manifest?.version !== CLOUD_REVIEW_SCHEMA_VERSION
		|| !/^\d{3}$/u.test(manifest.chapter)
		|| !/^[a-z0-9-]+$/u.test(manifest.scene)
		|| !/^[a-f0-9]{64}$/u.test(manifest.planHash)
		|| !Array.isArray(manifest.targets)
		|| manifest.targets.length > 500) {
		throw new Error('云审核批次格式无效。');
	}
	const keys = new Set();
	for (const target of manifest.targets) {
		if (!/^[a-f0-9]{64}$/u.test(target.reviewKey)
			|| keys.has(target.reviewKey)
			|| !/^[a-f0-9]{64}$/u.test(target.audio?.fileHash)
			|| !/^[a-f0-9]{64}$/u.test(target.audio?.renderHash)
			|| target.audio?.objectKey !== `review-audio/v${CLOUD_REVIEW_SCHEMA_VERSION}/${target.audio.fileHash}.${extensionForPath(target.audio.objectKey)}`) {
			throw new Error(`云审核目标无效：${target?.targetId || 'unknown'}。`);
		}
		keys.add(target.reviewKey);
	}
	return manifest;
}

export function validateCloudDecision(input, manifest) {
	if (input?.planHash !== manifest.planHash) {
		const error = new Error('审核批次已经更新，请刷新后再操作。');
		error.code = 'STALE_PLAN';
		throw error;
	}
	const target = manifest.targets.find((item) => item.reviewKey === input.reviewKey);
	if (!target) {
		const error = new Error('该片段已不在当前审核批次中。');
		error.code = 'STALE_TARGET';
		throw error;
	}
	if (!CLOUD_REVIEW_ACTIONS.includes(input.action)) throw new Error('只支持通过或重录。');
	const note = cleanText(input.note, MAX_REVIEW_NOTE_LENGTH);
	if (input.action === 'rerecord' && !note) throw new Error('重录时请填写简短意见。');
	if (!/^[a-zA-Z0-9-]{16,80}$/u.test(String(input.decisionId || ''))) throw new Error('审核操作标识无效。');
	return {
		decisionId: input.decisionId,
		planHash: manifest.planHash,
		reviewKey: target.reviewKey,
		targetId: target.targetId,
		action: input.action,
		note,
	};
}

export function nextReviewState(manifests, decisions) {
	const latest = new Map();
	for (const decision of decisions) latest.set(`${decision.plan_hash}:${decision.review_key}`, decision);
	let total = 0;
	let completed = 0;
	let target = null;
	let selectedManifest = null;
	let waitingForRender = 0;
	let projectRemaining = 0;
	for (const manifest of manifests) {
		waitingForRender += manifest.summary?.waitingForRender || 0;
		projectRemaining += manifest.summary?.remainingReviewCount || 0;
		for (const candidate of manifest.targets) {
			total += 1;
			if (latest.has(`${manifest.planHash}:${candidate.reviewKey}`)) {
				completed += 1;
				continue;
			}
			if (!target) {
				target = candidate;
				selectedManifest = manifest;
			}
		}
	}
	return {
		completed,
		total,
		remaining: total - completed,
		summary: { waitingForRender, projectRemaining },
		manifest: selectedManifest ? {
			chapter: selectedManifest.chapter,
			scene: selectedManifest.scene,
			planHash: selectedManifest.planHash,
			summary: selectedManifest.summary,
		} : null,
		target,
	};
}
