const fs = require('fs');
const path = require('path');
const { CHAPTERS_DIR, CHARACTER_CARDS_DIR } = require('../paths.cjs');

const chaptersDir = CHAPTERS_DIR;
const targets = [
	path.join(CHARACTER_CARDS_DIR, 'cards', '贾迎春.md'),
	path.join(CHARACTER_CARDS_DIR, '诗词赋作品', '贾迎春.md'),
	path.join(CHARACTER_CARDS_DIR, '家族线索.md'),
	path.join(CHARACTER_CARDS_DIR, '社会线索.md'),
	path.join(CHARACTER_CARDS_DIR, '时间轴汇总.md'),
];

const re = /【第(\d+)回】[「『](.+?)[」』]/g;

const files = {};
for (const f of fs.readdirSync(chaptersDir)) {
  const mm = f.match(/^(\d{3})-/);
  if (mm) files[parseInt(mm[1], 10)] = path.join(chaptersDir, f);
}

function stripMarks(s) {
  return s.replace(/\[(zp|mp|sc)\][\s\S]*?\[-\]/g, '');
}

const missing = [];
for (const target of targets) {
  let card;
  try { card = fs.readFileSync(target, 'utf8'); } catch (e) { console.log('无法读取:', target); continue; }
  const quotes = [];
  let m;
  while ((m = re.exec(card)) !== null) {
    quotes.push({ hui: parseInt(m[1], 10), text: m[2].trim(), src: path.basename(target) });
  }
  const huiCache = {};
  for (const q of quotes) {
    const file = files[q.hui];
    if (!file) { missing.push({ ...q, why: '无此回文件' }); continue; }
    if (!huiCache[q.hui]) {
      const raw = fs.readFileSync(file, 'utf8');
      huiCache[q.hui] = { raw, clean: stripMarks(raw) };
    }
    const { raw, clean } = huiCache[q.hui];
    let ok = clean.includes(q.text) || raw.includes(q.text);
    if (!ok) {
      const parts = q.text.split(/\[(zp|mp|sc)\][\s\S]*?\[-\]/g).filter(Boolean);
      if (parts.length > 1) {
        let idx = 0; ok = true;
        for (const p of parts) {
          const i = clean.indexOf(p, idx);
          if (i < 0) { ok = false; break; }
          idx = i + p.length;
        }
      }
    }
    if (!ok) missing.push({ ...q });
  }
}

console.log('命不中总条数:', missing.length);
for (const q of missing) {
  console.log(`[${q.src}] 第${q.hui}回: ${q.text}`);
}
