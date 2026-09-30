import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { cloudReviewRequest, loadCloudReviewConfig } from './cloud-review-client.js';
import { loadProductionBundle, saveReviewAction } from './review-state.js';

const PROJECT_ROOT = fileURLToPath(new URL('../..', import.meta.url));

function argumentsFor(argv) {
	const options = { chapter: '081', scene: 'xiren-three-opera' };
	for (let index = 0; index < argv.length; index += 2) {
		const name = argv[index]?.replace(/^--/u, '');
		const value = argv[index + 1];
		if (!['chapter', 'scene'].includes(name) || !value) throw new Error(`无法识别参数 ${argv[index] || ''}。`);
		options[name] = value;
	}
	options.chapter = String(options.chapter).padStart(3, '0');
	if (!/^\d{3}$/u.test(options.chapter) || !/^[a-z0-9-]+$/u.test(options.scene)) throw new Error('回目或场景参数无效。');
	return options;
}

export async function pullCloudReview({ projectRoot = PROJECT_ROOT, chapter, scene } = {}) {
	const config = await loadCloudReviewConfig(projectRoot);
	let bundle = await loadProductionBundle(projectRoot, chapter, scene);
	const query = new URLSearchParams({ chapter, scene, planHash: bundle.plan.planHash });
	const response = await cloudReviewRequest(config, `/api/sync/export?${query}`);
	const document = await response.json();
	if (document.planHash !== bundle.plan.planHash || !Array.isArray(document.decisions)) {
		throw new Error('云端审批结果与本地计划不一致。');
	}
	let imported = 0;
	for (const decision of document.decisions) {
		const before = bundle.approvals.records.find((record) => record.reviewKey === decision.review_key);
		if (before?.history?.some((event) => event.decisionId === decision.decision_id)) continue;
		bundle = await saveReviewAction({
			projectRoot,
			chapter,
			scene,
			planHash: document.planHash,
			reviewKey: decision.review_key,
			action: decision.action,
			decisionId: decision.decision_id,
			note: decision.note || '',
			...(decision.action === 'rerecord' ? {
				issueType: 'other',
				expectedEffect: decision.note,
			} : {}),
			now: decision.decided_at,
		});
		imported += 1;
	}
	return {
		imported,
		cloudDecisions: document.decisions.length,
		remainingReviewCount: bundle.status.counts.remainingReviewCount,
		managerTriageCount: bundle.status.managerTriage?.length || 0,
	};
}

async function main() {
	const result = await pullCloudReview(argumentsFor(process.argv.slice(2)));
	console.log(`云端决定 ${result.cloudDecisions} 条；本次新增同步 ${result.imported} 条。`);
	console.log(`仍未批准 ${result.remainingReviewCount} 条；待总控分派重录意见 ${result.managerTriageCount} 条。`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
	main().catch((error) => {
		console.error(`[云评审同步失败] ${error instanceof Error ? error.message : String(error)}`);
		process.exitCode = 1;
	});
}
