export const STYLE_AUDIT_SCHEMA_VERSION = 1;
export const STYLE_AUDIT_SEED = 20260918;

export const TRAINING_CHAPTERS = Object.freeze([
	1, 3, 5, 13, 17, 18, 40, 49, 53, 57, 62, 74, 77,
]);

export const TRAINING_GROUPS = Object.freeze([
	[1], [3], [5], [13], [17, 18], [40], [49], [53], [57], [62], [74], [77],
]);

export const CHUNK_CONFIG = Object.freeze({
	targetChars: 1200,
	minChars: 900,
	maxChars: 1500,
	minimumAuditChars: 200,
	mergeRemainderBelow: 600,
});

export const FEATURE_CONFIG = Object.freeze({
	mattrWindow: 100,
	topUnigrams: 48,
	topBigrams: 64,
	topTrigrams: 64,
	covarianceShrinkage: 0.2,
	covarianceRidge: 0.05,
});

export const NGRAM_CONFIG = Object.freeze({
	maxOrder: 5,
	alphaCandidates: [0.1, 0.3, 1, 3],
});

export const DEFAULT_PATHS = Object.freeze({
	corpus: 'research/文风审验/reference-corpus.json',
	model: 'research/文风审验/model/style-audit-model.json',
	audit: 'research/文风审验/runs/latest-audit.json',
	report: 'research/文风审验/runs/latest-report.md',
	referenceAnalysis: 'research/文风审验/reference-analysis.json',
	referenceReport: 'research/文风审验/reference-report.md',
});

export const FUNCTION_WORDS = Object.freeze([
	'的', '了', '着', '过', '也', '又', '还', '便', '就', '才', '只', '但', '却', '竟', '倒',
	'且', '并', '亦', '皆', '俱', '遂', '方', '正', '已', '未', '莫', '不', '无', '非', '若',
	'虽', '因', '为', '与', '同', '向', '于', '把', '将', '被', '给', '替', '连', '再', '越',
	'甚', '颇', '原', '果', '偏', '究竟', '何尝', '那里', '怎么', '如何', '什么', '如此', '这般',
	'那般', '罢了', '而已', '而且', '所以', '因此', '不免', '未免', '不过', '只得', '不得',
	'可知', '谁知', '岂知', '哪知', '若是', '倘若', '纵然', '一面', '一壁', '一则', '二则',
]);

export const NARRATIVE_FORMULAS = Object.freeze([
	'话说', '且说', '却说', '原来', '谁知', '不想', '不料', '一时', '少时', '半晌', '良久',
	'只见', '忽见', '忽听', '听见', '看见', '不多时', '说话间', '正说着', '正想着',
	'一语未了', '言犹未了', '忙道', '笑道', '说道', '问道', '答道', '叹道', '哭道',
	'心下', '暗想', '不在话下', '按下不提', '后事如何', '下回分解',
]);

export const PUNCTUATION_FEATURES = Object.freeze([
	'，', '。', '；', '：', '！', '？', '、', '“', '”', '‘', '’', '——', '……',
]);

// A deliberately versioned, corpus-focused map. It normalizes the mixed
// orthography present in this repository without changing lexical choices.
const VARIANT_PAIRS = [
	'風风', '夢梦', '開开', '來来', '裏里', '裡里', '説说', '說说', '見见', '聽听',
	'這这', '個个', '為为', '與与', '後后', '時时', '會会', '門门', '東东', '無无',
	'長长', '應应', '過过', '還还', '頭头', '點点', '當当', '問问', '間间', '兩两',
	'麼么', '寫写', '認认', '樣样', '發发', '國国', '寶宝', '賈贾', '鳳凤', '園园',
	'難难', '斷断', '歸归', '體体', '話话', '對对', '給给', '讓让', '進进', '邊边',
	'轉转', '從从', '聲声', '氣气', '處处', '處处', '覺觉', '實实', '卻却', '聖圣',
	'萬万', '歲岁', '書书', '畫画', '舊旧', '親亲', '愛爱', '惱恼', '興兴', '禮礼',
	'滿满', '爾尔', '婦妇', '孫孙', '馬马', '車车', '錢钱', '銀银', '買买', '賣卖',
	'紅红', '綠绿', '黃黄', '藍蓝', '詩诗', '詞词', '讀读', '學学', '師师', '兒儿',
	'爺爷', '媽妈', '爭争', '罷罢', '雖虽', '豈岂', '雲云', '葉叶', '蘭兰', '懷怀',
	'尋寻', '將将', '經经', '從从', '準准', '備备', '眾众', '雜杂', '壞坏', '殺杀',
	'驚惊', '歡欢', '憂忧', '慮虑', '慘惨', '嬌娇', '憐怜', '憑凭', '據据', '總总',
	'樣样', '緣缘', '續续', '餘余', '賢贤', '齊齐', '齋斋', '廟庙', '廳厅', '樓楼',
	'館馆', '閣阁', '院院', '牆墙', '燈灯', '爐炉', '鏡镜', '簾帘', '衫衫', '襖袄',
	'羅罗', '繡绣', '針针', '線线', '飯饭', '飲饮', '餓饿', '飽饱', '藥药', '醫医',
	'聰聪', '勸劝', '議议', '論论', '該该', '許许', '請请', '謝谢', '辭辞', '諒谅',
	'記记', '傳传', '報报', '訴诉', '語语', '謊谎', '謂谓', '誤误', '調调', '辦办',
	'別别', '離离', '遠远', '近近', '遲迟', '趕赶', '隨随', '達达', '選选', '擇择',
	'寧宁', '榮荣', '瀟潇', '綺绮', '鴛鸳', '鴦鸯', '鶯莺', '鵑鹃', '鶴鹤',
	'龍龙', '龜龟', '靈灵', '壽寿', '節节', '慶庆', '喪丧', '墳坟', '塚冢', '壇坛',
	'壇坛', '禪禅', '觀观', '廟庙', '隱隐', '顯显', '權权', '勢势', '貴贵', '賤贱',
	'職职', '官官', '軍军', '賊贼', '戰战', '亂乱', '獄狱', '罰罚', '賞赏', '賜赐',
	'審审', '驗验', '檢检', '查查', '護护', '養养', '撫抚', '攙搀', '擡抬', '抬抬',
	'攢攒', '擔担', '擬拟', '擇择', '攔拦', '攪搅', '攜携', '攝摄', '攏拢', '攤摊',
	'搖摇', '擺摆', '擲掷', '撲扑', '撿捡', '掃扫', '掛挂', '帶带', '幫帮', '幾几',
	'條条', '張张', '則则', '劉刘', '楊杨', '趙赵', '鄧邓', '薛薛', '襲袭', '黛黛',
	'艷艳', '嚴严', '鹹咸', '獨独', '復复', '鬧闹', '閒闲', '閑闲', '纔才', '衹只',
];

export const ORTHOGRAPHY_MAP_VERSION = 'corpus-s2t-2026-09-18';
export const ORTHOGRAPHY_MAP = new Map(VARIANT_PAIRS.map((pair) => [...pair]));
