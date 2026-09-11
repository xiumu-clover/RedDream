const path = require('node:path');
const { existsSync } = require('node:fs');

const ROOT_DIR = path.resolve(__dirname, '..', '..');
const RESEARCH_DIR = path.join(ROOT_DIR, 'research');

if (!existsSync(RESEARCH_DIR)) {
	throw new Error(
		'找不到 research/ 私有研究仓库；请先将 RedDream-Research 克隆到项目根目录的 research/。',
	);
}

module.exports = {
	ROOT_DIR,
	RESEARCH_DIR,
	CHAPTERS_DIR: path.join(ROOT_DIR, 'content', 'chapters', 'hongloumeng'),
	GUIYOU_CHAPTERS_DIR: path.join(ROOT_DIR, 'content', 'chapters', 'guiyou'),
	GUIYOU_ORIGINAL_CHAPTERS_DIR: path.join(ROOT_DIR, 'content', 'chapters', 'guiyou-original'),
	CHARACTER_CARDS_DIR: path.join(RESEARCH_DIR, 'character-cards'),
	CONTINUATION_REVIEW_DIR: path.join(RESEARCH_DIR, '续书对照'),
	ZHIPI_DIR: path.join(RESEARCH_DIR, '脂批'),
};
