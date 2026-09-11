const fs = require('fs');
const path = require('path');
const { CHAPTERS_DIR, CHARACTER_CARDS_DIR } = require('../paths.cjs');

const chaptersDir = CHAPTERS_DIR;
const cardPath = path.join(CHARACTER_CARDS_DIR, 'cards', '袭人.md');

const card = fs.readFileSync(cardPath, 'utf8');

// 提取所有 【第X回】「引用」 对
const re = /【第(\d+)回】[「『](.+?)[」』]/g;
const quotes = [];
let m;
while ((m = re.exec(card)) !== null) {
  quotes.push({ hui: parseInt(m[1], 10), text: m[2].trim() });
}
console.log('卡片中引用总数:', quotes.length);

// 每回文件（含繁体文件名可能）
const files = {};
for (const f of fs.readdirSync(chaptersDir)) {
  const mm = f.match(/^(\d{3})-/);
  if (mm) files[parseInt(mm[1], 10)] = path.join(chaptersDir, f);
}

function stripMarks(s) {
  // 去掉 [zp]...[-] [mp]...[-] [sc]...[-] 标记（含其内容）
  return s.replace(/\[(zp|mp|sc)\][\s\S]*?\[-\]/g, '');
}

const missing = [];
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
    // 归一化：去除中间夹着的标记再试（引用可能跨脂批）
    const qClean = q.text;
    // 把引用本身按标记切分后逐段检查是否按序出现
    const parts = qClean.split(/\[(zp|mp|sc)\][\s\S]*?\[-\]/g).filter(Boolean);
    if (parts.length > 1) {
      let idx = 0;
      ok = true;
      for (const p of parts) {
        const i = clean.indexOf(p, idx);
        if (i < 0) { ok = false; break; }
        idx = i + p.length;
      }
    }
  }
  if (!ok) missing.push({ ...q });
}

console.log('命不中条数:', missing.length);
for (const q of missing) {
  console.log(`[第${q.hui}回] ${q.text}`);
}
