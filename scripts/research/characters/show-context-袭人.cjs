const fs = require('fs');
const path = require('path');
const { CHAPTERS_DIR, CHARACTER_CARDS_DIR } = require('../paths.cjs');

const chaptersDir = CHAPTERS_DIR;
const cardPath = path.join(CHARACTER_CARDS_DIR, 'cards', '袭人.md');

const card = fs.readFileSync(cardPath, 'utf8');
const re = /【第(\d+)回】[「『](.+?)[」』]/g;
const quotes = [];
let m;
while ((m = re.exec(card)) !== null) quotes.push({ hui: parseInt(m[1], 10), text: m[2].trim() });

const files = {};
for (const f of fs.readdirSync(chaptersDir)) {
  const mm = f.match(/^(\d{3})-/);
  if (mm) files[parseInt(mm[1], 10)] = path.join(chaptersDir, f);
}
function stripMarks(s) { return s.replace(/\[(zp|mp|sc)\][\s\S]*?\[-\]/g, ''); }

const huiCache = {};
const missingList = process.argv.slice(2); // 可传回次过滤
for (const q of quotes) {
  const file = files[q.hui];
  if (!file) continue;
  if (!huiCache[q.hui]) {
    huiCache[q.hui] = stripMarks(fs.readFileSync(file, 'utf8'));
  }
  const clean = huiCache[q.hui];
  if (clean.includes(q.text)) continue;
  if (missingList.length && !missingList.includes(String(q.hui))) continue;
  // 用引用前6字找最近上下文
  const probe = q.text.slice(0, 6);
  const idx = clean.indexOf(probe);
  let ctx = '';
  if (idx >= 0) {
    ctx = clean.slice(Math.max(0, idx - 25), idx + 90);
  } else {
    // 逐字缩短探测
    for (let len = 5; len >= 2; len--) {
      const p2 = q.text.slice(0, len);
      const i2 = clean.indexOf(p2);
      if (i2 >= 0) {
        ctx = '[前' + len + '字命中] ' + clean.slice(Math.max(0, i2 - 25), i2 + 90);
        break;
      }
    }
    if (!ctx) ctx = '(连2字都未命中)';
  }
  console.log(`\n[第${q.hui}回] 卡片引用: ${q.text}\n  原文附近: ${ctx}`);
}
