const fs = require('fs');
const path = require('path');
const { CHAPTERS_DIR, CHARACTER_CARDS_DIR } = require('../paths.cjs');

const chaptersDir = CHAPTERS_DIR;
const cardPath = path.join(CHARACTER_CARDS_DIR, 'cards', '林黛玉.md');

const card = fs.readFileSync(cardPath, 'utf8');

// 提取所有 【第X回】「引用」 对
const re = /【第(\d+)回】[「『](.+?)[」』]/g;
const quotes = [];
let m;
while ((m = re.exec(card)) !== null) {
  quotes.push({ hui: parseInt(m[1], 10), text: m[2].trim() });
}
console.log('卡片中引用总数:', quotes.length);

// 每回文件
const files = {};
for (const f of fs.readdirSync(chaptersDir)) {
  const mm = f.match(/^(\d{3})-/);
  if (mm) files[parseInt(mm[1], 10)] = path.join(chaptersDir, f);
}

function stripMarks(s) {
  // 仅删除脂批[zp]、校记[mp]及其内容；保留诗词[sc]正文（仅去除容器标记）
  return s.replace(/\[(zp|mp)\][\s\S]*?\[-\]/g, '').replace(/\[sc\]/g, '').replace(/\[-\]/g, '');
}

// 归一化引号与空白：弯双/单引号、直角引号、直引号统一为 "；全角空白归一
function norm(s) {
  return s
    .replace(/[\n\r]+/g, '')
    .replace(/[“”‘’「」『』]/g, '"')
    .replace(/[‘’]/g, '"')
    .replace(/'/g, '"')
    .replace(/[ 　]+/g, ' ');
}

const missing = [];
const huiCache = {};
for (const q of quotes) {
  const file = files[q.hui];
  if (!file) { missing.push({ ...q, why: '无此回文件' }); continue; }
  if (!huiCache[q.hui]) {
    const raw = fs.readFileSync(file, 'utf8');
    huiCache[q.hui] = { raw, clean: stripMarks(raw), norm: norm(stripMarks(raw)) };
  }
  const { raw, clean, norm: n } = huiCache[q.hui];
  let ok = clean.includes(q.text) || raw.includes(q.text);
  if (!ok) {
    // 引号归一化后比较
    const qn = norm(q.text);
    ok = n.includes(qn);
    if (!ok) {
      // 末尾标点宽容：尝试去掉或追加常见句读标点
      const cands = [qn.replace(/[。？！，、；：]$/, ''), qn + '。', qn + '？', qn + '！', qn + '，', qn.replace(/[。？！]$/, '')];
      for (const cc of cands) { if (cc && n.includes(cc)) { ok = true; break; } }
    }
  }
  if (!ok) {
    // 去掉原文省略号「……」后再试
    const t = norm(q.text.replace(/……/g, ''));
    ok = n.includes(t);
  }
  if (!ok) {
    // 按标记切分后逐段检查
    const parts = q.text.split(/\[(zp|mp|sc)\][\s\S]*?\[-\]/g).filter(Boolean);
    if (parts.length > 1) {
      let idx = 0;
      ok = true;
      for (const p of parts) {
        const i = n.indexOf(norm(p), idx);
        if (i < 0) { ok = false; break; }
        idx = i + norm(p).length;
      }
    }
  }
  if (!ok) missing.push({ ...q });
}

console.log('命不中条数:', missing.length);
for (const q of missing) {
  console.log(`[第${q.hui}回] ${q.text}`);
}
