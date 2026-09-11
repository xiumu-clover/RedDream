/**
 * 脂批整理管线
 *
 * 复用站点的章节编译器解析 1-80 回，不再维护简化标记状态机。
 * 输出全录、多见证分档、自动分类简析、伏线复核任务和结构化 JSON。
 * 运行：npm run extract:zhipi
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { compileChapter } from "../../../src/lib/chapters/compiler.ts";

const CHAPTERS_DIR = "content/chapters/hongloumeng";
const RESEARCH_DIR = "research";
const OUT_DIR = "research/脂批";
const OUTPUTS = {
  full: join(OUT_DIR, "脂批全录.md"),
  tiered: join(OUT_DIR, "脂批分档全录.md"),
  analysis: join(OUT_DIR, "脂批分析全录.md"),
  foreshadow: join(OUT_DIR, "脂批伏线摘录.md"),
  review: join(OUT_DIR, "脂批伏线复核任务.md"),
  report: join(OUT_DIR, "脂批整理报告.md"),
  data: join(OUT_DIR, "脂批数据.json"),
};
const ANCHOR_KEEP = 90;
const ANCHOR_TAIL = 45;

const TIER_NAMES = { 1: "第一档", 2: "第二档", 3: "第三档", 4: "第四档", 0: "未定档" };
const SOURCE_CLASS_NAMES = {
  "fat-comment": "脂本批语",
  "editor-mediated-fat-comment": "现代校按转引的脂批",
  editorial: "现代校按",
  "later-comment": "后出评论",
  "version-heading": "版本题记",
  unknown: "来源未明",
};
const LOCUS_STATUS_NAMES = {
  single: "单条批点",
  "multi-comment-locus": "同处并列独立评论",
  "parallel-identical": "同批同文",
  "parallel-variant": "疑似同批异文",
  "mixed-locus": "同处混合（异文兼独立评论）",
};

// 档位只表示版本见证的传抄参考优先级，不表示批语观点必然正确。
const WITNESS_DEFS = [
  { id: "jiaxu", name: "甲戌本", tier: 1, re: /甲戌|甲(?=侧|側|眉|夹|夾|双|雙|末|墨)/u },
  { id: "jimao", name: "己卯本", tier: 1, re: /己卯/u },
  { id: "gengchen", name: "庚辰本", tier: 1, re: /庚辰|庚(?=双|雙|侧|側|眉|夹|夾|批|$)|前庚|辰(?=夹|夾|侧|側|眉)/u },
  { id: "qixu", name: "戚序本", tier: 2, re: /戚序|戚本|戚(?=夹|夾|侧|側|眉|双|雙|回|蒙|$)/u },
  { id: "mengfu", name: "蒙府本", tier: 2, re: /蒙府|蒙古王府|蒙(?=侧|側|夹|夾|双|雙|眉|回|前|后|末|列|戚|甲|本|$)/u },
  { id: "liecang", name: "列藏本", tier: 3, re: /列藏|列本|列(?=侧|側|夹|夾|双|雙|眉|庚|批|、|混|$)/u },
  { id: "shuxu", name: "舒序本", tier: 3, re: /舒序|舒本|舒元炜/u },
  { id: "menggao", name: "梦稿本", tier: 3, re: /梦稿/u },
  { id: "mengben", name: "梦本（简称待辨）", tier: 3, re: /^梦$/u },
  { id: "jiachen", name: "甲辰本（梦觉本）", tier: 3, re: /甲辰|梦觉|梦序/u },
  { id: "jingcang", name: "靖藏本", tier: 4, re: /靖藏|靖本|靖(?=侧|側|眉|夹|夾|末|前|回|此|朱|批|$)/u },
  { id: "gengyin", name: "庚寅本（来源待考）", tier: 4, re: /庚寅/u },
  { id: "wuzu", name: "吴祖本相关（存疑）", tier: 4, re: /吴祖|吴梅村/u },
];

const LATER_COMMENTATORS = [
  { id: "buzhuozhai", name: "补拙斋", re: /补拙斋|拙斋/u },
  { id: "jiufeng", name: "九峰真人", re: /九峰/u },
  { id: "unknown-collator", name: "校者/按者", re: /^(?:校者|按者|按)(?:注)?/u },
];
const EDITORIAL_AGENTS = [{ id: "song", name: "松按/松注/松批", re: /^松(?:按|注|批)/u }];

const TITLE_SOURCES = new Map([
  ["戚蓼生序", ["qixu"]],
  ["甲戌本凡例", ["jiaxu"]],
  ["梦觉主人序", ["jiachen"]],
  ["舒元炜序", ["shuxu"]],
]);

const CATEGORY_RULES = [
  { name: "校勘", re: /校(?:勘|记|者)|各本|此本|本作|本无|本有|原作|改作|应作|或作|脱文|缺文|衍文|讹|误抄|抄误|错简|移于|混入正文|从.+本|字当|句当|墨笔|朱笔/u },
  { name: "记事", re: /壬午|甲午|畸笏|脂砚斋|芹为|雪芹|棠村|批书人|再评|抄阅|除夕|泪尽而逝|书未成|年月|某日/u },
  { name: "谐音拆字", re: /谐音|拆字|寓意|托言|应怜|原应叹息|真事隐|假语存|甄贾|“[^”]{1,8}”也|音同|取名/u },
  { name: "伏线暗示", re: /伏(?:后文|下文|后|下|线|笔|根|案|此|彼|起|住|长安|荣国府|大观园)|后文(?:方|始|自|见|有|如何|可知|照应|收拾)|后回|后卅|后四十|后三十|后半部|下半部|草蛇灰线|千里伏线|遥遥相照|预为|谶|大关键|大过节/u },
  { name: "文法点评", re: /章法|笔法|文法|写法|结构|照应|映带|点染|皴染|反衬|陪衬|收束|收住|起笔|落笔|一笔|文字|文气|行文|转折|穿插|倒叙|补叙|虚写|实写|不写之写|烟云模糊|横云断岭|烘云托月|反面敷粉|机轴|机括/u },
  { name: "索隐附会", re: /作者(?:是|身份)|吴梅村|纳兰|明珠|高江村|影射|隐射|指.+而言|本朝|故老云|无疑|索隐/u },
  { name: "道德褒贬", re: /英雄|奸雄|奸险|小人|恶极|坏极|可恨|可恶|该打|贤|孝|不肖|正人|下流|负义|薄情|淫|妒|毒|善人|恶人|道学|腐儒|罪/u },
  { name: "情感抒发", re: /余(?:为|亦|常|不禁|读)|我(?:为|亦|哭)|哭|泪|叹叹|一叹|伤心|悲切|可怜|痛哭|呜咽|怅怅|心疼/u },
  { name: "人物情节解读", re: /写(?:出|尽|足|明|到|活)?(?:宝玉|黛玉|宝钗|凤姐|雨村|袭人|晴雯|湘云|可卿|人物|此人)|形容|声口|口气|心事|心意|神情|性情|身份|一干人|此等人|之态|之情/u },
  { name: "文本释义", re: /(?:^|：)(?:此|是|即|乃|盖|所谓|言|指|点|总|补|承|应|对应|正为|本名|书之本旨|以下系|上文是|下文是)|点[“「][^”」]+[”」](?:字)?|总纲|总收|题纲/u },
  { name: "阅读提示", re: /要紧|记清|着眼|看官|看此|读者|观者|细看|细思|可思|不可少|不必|不妨|留心|注意|莫作|请看|请问|再看|当看|切记/u },
  { name: "艺术鉴赏", re: /妙|奇|好文|好看|绝妙|传神|神妙|大手笔|仙笔|活现|如见|如闻|拜服|新鲜|有趣|痛快|精细|毕肖|精彩|(?:^|：)(?:好|细|是极|极是|不谬|有理|妥|逼真|传神|痛快|爽快)[！。]?$/u },
];
const CATEGORY_PRIORITY = ["版本题记", "校勘", "记事", "谐音拆字", "伏线暗示", "文法点评", "索隐附会", "道德褒贬", "情感抒发", "人物情节解读", "文本释义", "阅读提示", "艺术鉴赏", "综合评点（待细分）"];

function shortHash(value, length = 10) {
  return createHash("sha1").update(value).digest("hex").slice(0, length);
}
function normalizeSpace(value) {
  return value.replace(/\s+/gu, " ").trim();
}
function flattenNodes(nodes) {
  let output = "";
  for (const node of nodes) {
    if (node.type === "text") output += node.value;
    else if (node.type === "hard-break") output += " ";
    else if (node.type === "note-reference") output += node.id;
    else if (node.type === "image") output += node.caption ?? "";
    else if (node.type === "mark") output += flattenNodes(node.children);
  }
  return normalizeSpace(output);
}
function unwrapComment(value) {
  let text = normalizeSpace(value);
  for (const [left, right] of [["【", "】"], ["（", "）"], ["[", "]"]]) {
    if (text.startsWith(left) && text.endsWith(right)) {
      text = text.slice(left.length, -right.length).trim();
      break;
    }
  }
  return text;
}
function cleanAnchor(value) {
  return normalizeSpace(value).replace(/^---[\s\S]*?---\s*/u, "").replace(/[【】]/gu, "").slice(-ANCHOR_TAIL);
}
function sourcePrefix(comment) {
  const match = comment.match(/^([^：\n]{1,60})：/u);
  if (match) return match[1].trim();
  if (comment.length <= 60 && /^(?:甲|己卯|庚|戚|蒙|列|舒|梦|靖|吴祖|补拙斋|拙斋|松按|九峰)/u.test(comment)) return comment;
  return "";
}
function coreComment(comment) {
  const match = comment.match(/^[^：\n]{1,60}：([\s\S]*)$/u);
  return normalizeSpace(match ? match[1] : comment);
}
function witnessById(id) {
  return WITNESS_DEFS.find((item) => item.id === id);
}

export function parseSources(comment, inheritedWitnessIds = []) {
  const titleWitnessIds = TITLE_SOURCES.get(comment.trim());
  if (titleWitnessIds) {
    return {
      sourceLabel: comment.trim(),
      witnesses: titleWitnessIds.map(witnessById).filter(Boolean),
      agents: [], sourceMode: "title", sourceClass: "version-heading", startsInheritance: titleWitnessIds,
    };
  }
  const label = sourcePrefix(comment);
  const scanTarget = label || comment.slice(0, 30);
  const witnesses = WITNESS_DEFS.filter((item) => item.re.test(scanTarget));
  const laterAgents = LATER_COMMENTATORS.filter((item) => item.re.test(scanTarget));
  const editorialAgents = EDITORIAL_AGENTS.filter((item) => item.re.test(scanTarget));
  const agents = [...editorialAgents, ...laterAgents].map(({ id, name }) => ({ id, name }));
  let sourceMode = "explicit";
  if (!witnesses.length && !agents.length && inheritedWitnessIds.length) {
    sourceMode = "inherited";
    witnesses.push(...inheritedWitnessIds.map(witnessById).filter(Boolean));
  } else if (!witnesses.length && !agents.length) sourceMode = "unknown";

  let sourceClass = "unknown";
  if (editorialAgents.length && witnesses.length) sourceClass = "editor-mediated-fat-comment";
  else if (editorialAgents.length) sourceClass = "editorial";
  else if (witnesses.length) sourceClass = "fat-comment";
  else if (laterAgents.length) sourceClass = "later-comment";
  return { sourceLabel: label, witnesses, agents, sourceMode, sourceClass, startsInheritance: null };
}

function makeAnalysisNote(primaryCategory) {
  return {
    校勘: "涉及版本文字、位置或传抄差异；可作文本线索，引用前应核对影印本。",
    记事: "涉及作者、批者或成书信息；只能作为史料旁证，不宜单独定案。",
    谐音拆字: "解释命名或字词寓意；可回到正文逐字验证。",
    伏线暗示: "提出后文照应或情节预示；目前仅是待验证假设。",
    文法点评: "评论叙事结构和写作手法；适合作阅读提示，不等同于情节事实。",
    索隐附会: "包含身份影射或索隐推断；保存备查，不作为正文事实。",
    道德褒贬: "带有明显人物褒贬；主观性较强，不作为人物评价证据。",
    情感抒发: "主要呈现批者个人感受；可观察接受史，不作为事实证据。",
    人物情节解读: "解释人物心理、声口或情节作用；应与批点正文互证，防止把批者判断当成事实。",
    文本释义: "对局部字句或情节作解释；可作为阅读线索，仍需核对批点是否准确。",
    阅读提示: "提示读者留意关键字句或前后关系；本身通常不构成独立事实主张。",
    艺术鉴赏: "属于审美赞评；可供阅读参考，证据权重较低。",
    版本题记: "用于标明序跋或版本批语区段；属于来源结构，不作为正文论据。",
    "综合评点（待细分）": "包含局部解释、感想或短评，自动规则不足以可靠细分；需要人工结合批点正文判断。",
  }[primaryCategory];
}

export function classifyContent(comment, sourceInfo = {}, embeddedIn = []) {
  const categories = CATEGORY_RULES.filter((rule) => rule.re.test(comment)).map((rule) => rule.name);
  if (sourceInfo.sourceClass === "version-heading") categories.push("版本题记");
  if (!categories.length) categories.push("综合评点（待细分）");
  categories.sort((a, b) => CATEGORY_PRIORITY.indexOf(a) - CATEGORY_PRIORITY.indexOf(b));
  const primaryCategory = categories[0];
  const riskFlags = [];
  if (sourceInfo.sourceMode === "unknown") riskFlags.push("来源未明");
  if (sourceInfo.sourceMode === "inherited") riskFlags.push("来源继承推定");
  if (sourceInfo.sourceClass === "editorial") riskFlags.push("现代校按/非脂批");
  if (sourceInfo.sourceClass === "editor-mediated-fat-comment") riskFlags.push("经现代校按转引");
  if (sourceInfo.sourceClass === "later-comment") riskFlags.push("后出评论者");
  if (sourceInfo.witnesses?.some((witness) => witness.tier === 4)) riskFlags.push("版本来源存疑");
  if (embeddedIn.includes("zp")) riskFlags.push("脂批内嵌引文");
  if (embeddedIn.includes("mp")) riskFlags.push("校按内转引");
  if (categories.includes("伏线暗示")) riskFlags.push("伏线待验证");
  if (categories.includes("道德褒贬")) riskFlags.push("主观褒贬");
  if (categories.includes("情感抒发")) riskFlags.push("情感偏向");
  if (categories.includes("索隐附会")) riskFlags.push("索隐风险");
  if (categories.includes("艺术鉴赏") && categories.length === 1) riskFlags.push("纯审美判断");
  return {
    categories, primaryCategory, riskFlags: [...new Set(riskFlags)],
    analysisNote: makeAnalysisNote(primaryCategory), classificationMethod: "关键词启发式初分", reviewStatus: "待人工复核",
  };
}

/** 从章节 AST 提取全部 zp 节点，包括脂批/校按内部嵌套的 zp。 */
export function extractChapterFromSource(source, fileName, chapterNumber) {
  const compiled = compileChapter(source, { sourceName: fileName });
  const entries = [];
  let recentBody = "";
  let bodyCursorOffset = 0;
  let seenTitle = false;
  const updateBody = (value, offset) => {
    if (!seenTitle || !value) return;
    recentBody = (recentBody + value).slice(-ANCHOR_KEEP);
    bodyCursorOffset = offset;
  };
  const walk = (nodes, ancestors = [], includeInBody = true) => {
    for (const node of nodes) {
      if (node.type === "text") {
        if (includeInBody) updateBody(node.value, node.position.offset + node.value.length);
        continue;
      }
      if (node.type === "hard-break") {
        if (includeInBody) updateBody(" ", node.position.offset + 2);
        continue;
      }
      if (node.type !== "mark") continue;
      if (node.kind === "title") {
        seenTitle = true;
        walk(node.children, [...ancestors, "title"], true);
      } else if (node.kind === "zp") {
        const comment = unwrapComment(flattenNodes(node.children));
        const ordinal = entries.length + 1;
        entries.push({
          id: `zp-${String(chapterNumber).padStart(3, "0")}-${String(ordinal).padStart(4, "0")}-${shortHash(comment, 8)}`,
          chapter: chapterNumber, chapterTitle: compiled.title, ordinal,
          sourceFile: relative(".", join(CHAPTERS_DIR, fileName)).replaceAll("\\", "/"),
          sourceLine: node.position.line, sourceColumn: node.position.column, sourceOffset: node.position.offset,
          locusId: `loc-${String(chapterNumber).padStart(3, "0")}-${bodyCursorOffset}`,
          locusOffset: bodyCursorOffset, anchor: cleanAnchor(recentBody), comment,
          embeddedIn: ancestors.filter((kind) => kind === "zp" || kind === "mp"),
        });
        walk(node.children, [...ancestors, "zp"], false);
      } else if (node.kind === "mp") {
        walk(node.children, [...ancestors, "mp"], false);
      } else walk(node.children, [...ancestors, node.kind], includeInBody);
    }
  };
  walk(compiled.nodes);
  return { title: compiled.title, entries };
}

function enrichSourcesAndAnalysis(perChapter) {
  for (const chapter of perChapter) {
    let inheritedWitnessIds = [];
    for (const entry of chapter.entries) {
      const sourceInfo = parseSources(entry.comment, inheritedWitnessIds);
      if (sourceInfo.startsInheritance) inheritedWitnessIds = sourceInfo.startsInheritance;
      else if (sourceInfo.sourceMode === "explicit" && (sourceInfo.witnesses.length || sourceInfo.agents.length)) inheritedWitnessIds = [];
      const tiers = sourceInfo.witnesses.map((witness) => witness.tier);
      const bestTier = tiers.length ? Math.min(...tiers) : 0;
      Object.assign(entry, {
        sourceLabel: sourceInfo.sourceLabel, sourceMode: sourceInfo.sourceMode, sourceClass: sourceInfo.sourceClass,
        witnesses: sourceInfo.witnesses.map(({ id, name, tier }) => ({ id, name, tier })), agents: sourceInfo.agents,
        bestTier, tierLabel: TIER_NAMES[bestTier],
      });
      Object.assign(entry, classifyContent(entry.comment, sourceInfo, entry.embeddedIn));
      entry.coreComment = coreComment(entry.comment);
      entry.coreHash = shortHash(entry.coreComment, 12);
    }
  }
}

function textSimilarity(left, right) {
  const clean = (value) => value.replace(/[\s，。！？；：“”‘’、（）()…·—《》〈〉「」『』□]/gu, "");
  const a = clean(left);
  const b = clean(right);
  if (a === b) return 1;
  if (Math.min(a.length, b.length) < 4) return 0;
  if (a.includes(b) || b.includes(a)) return Math.min(a.length, b.length) / Math.max(a.length, b.length);
  const bigrams = (value) => {
    const result = [];
    for (let index = 0; index < value.length - 1; index += 1) result.push(value.slice(index, index + 2));
    return result;
  };
  const aPairs = bigrams(a);
  const bPairs = bigrams(b);
  const remaining = new Map();
  for (const pair of bPairs) remaining.set(pair, (remaining.get(pair) ?? 0) + 1);
  let intersection = 0;
  for (const pair of aPairs) {
    if ((remaining.get(pair) ?? 0) > 0) {
      intersection += 1;
      remaining.set(pair, remaining.get(pair) - 1);
    }
  }
  return (2 * intersection) / (aPairs.length + bPairs.length);
}

function collateLoci(perChapter) {
  const allEntries = perChapter.flatMap((chapter) => chapter.entries);
  const groups = Map.groupBy(allEntries, (entry) => entry.locusId);
  const loci = [];
  for (const [locusId, entries] of groups) {
    const variants = [...new Set(entries.map((entry) => normalizeSpace(entry.coreComment)))];
    const similarities = [];
    for (let i = 0; i < variants.length; i += 1) {
      for (let j = i + 1; j < variants.length; j += 1) similarities.push(textSimilarity(variants[i], variants[j]));
    }
    const hasLikelyVariant = similarities.some((score) => score >= 0.58);
    const status = entries.length === 1
      ? "single"
      : variants.length === 1
        ? "parallel-identical"
        : hasLikelyVariant && entries.length > 2
          ? "mixed-locus"
          : hasLikelyVariant
            ? "parallel-variant"
            : "multi-comment-locus";
    loci.push({
      id: locusId, chapter: entries[0].chapter, anchor: entries[0].anchor,
      entryIds: entries.map((entry) => entry.id), entryCount: entries.length, variantCount: variants.length,
      maxTextSimilarity: similarities.length ? Math.max(...similarities) : 1,
      status, reviewStatus: entries.length > 1 ? "待异文校合" : "单条",
    });
    for (const entry of entries) {
      entry.locusStatus = status;
      entry.locusEntryCount = entries.length;
      if (["parallel-variant", "mixed-locus"].includes(status)) entry.riskFlags.push("疑似同批异文待校合");
    }
  }
  return loci;
}

export function buildDataset(chaptersDir = CHAPTERS_DIR) {
  const files = readdirSync(chaptersDir)
    .filter((file) => /^\d{3}-/u.test(file))
    .map((file) => ({ file, number: Number.parseInt(file.slice(0, 3), 10) }))
    .filter(({ number }) => number >= 1 && number <= 80)
    .sort((a, b) => a.number - b.number);
  const perChapter = [];
  let rawMarkerTotal = 0;
  for (const { file, number } of files) {
    const source = readFileSync(join(chaptersDir, file), "utf8");
    const markerCount = source.match(/\[zp\]/gu)?.length ?? 0;
    rawMarkerTotal += markerCount;
    const extracted = extractChapterFromSource(source, file, number);
    if (extracted.entries.length !== markerCount) throw new Error(`${file}: 源文有 ${markerCount} 个 [zp]，AST 提取 ${extracted.entries.length} 条。`);
    perChapter.push({ number, file, title: extracted.title, entries: extracted.entries });
  }
  enrichSourcesAndAnalysis(perChapter);
  const loci = collateLoci(perChapter);
  const entries = perChapter.flatMap((chapter) => chapter.entries);
  return {
    schemaVersion: 1,
    scope: { startChapter: 1, endChapter: 80, chapterCount: files.length },
    integrity: { rawZpMarkerCount: rawMarkerTotal, extractedEntryCount: entries.length, countsMatch: rawMarkerTotal === entries.length },
    chapters: perChapter.map(({ number, file, title, entries: chapterEntries }) => ({ number, file, title, entryCount: chapterEntries.length })),
    loci, entries,
  };
}

function countBy(items, keyFn) {
  const counts = new Map();
  for (const item of items) {
    const keys = keyFn(item);
    for (const key of Array.isArray(keys) ? keys : [keys]) counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0]), "zh-CN"));
}
function mdEscape(value) {
  return String(value).replaceAll("|", "\\|").replaceAll("\n", " ");
}
function sourceDisplay(entry) {
  const names = entry.witnesses.map((witness) => witness.name);
  if (entry.agents.length) names.push(...entry.agents.map((agent) => agent.name));
  return names.length ? names.join("、") : "来源未明";
}
function entryMeta(entry) {
  return `【${entry.id}】【${sourceDisplay(entry)}】【${entry.primaryCategory}】【源码 L${entry.sourceLine}:C${entry.sourceColumn}】`;
}

function generateFull(dataset) {
  const lines = [
    "# 脂批全录（前八十回）", "",
    `> 共 ${dataset.entries.length} 条；源文 \`[zp]\` 标记 ${dataset.integrity.rawZpMarkerCount} 个，数量${dataset.integrity.countsMatch ? "一致" : "不一致"}。`,
    "> 由章节编译器 AST 提取，包含脂批或校按内部嵌套的 `[zp]`；每条保留稳定 ID、源码行列、多见证来源和初步分类。",
    "> 版本档位只表示传抄参考优先级，不表示批语观点必然正确。自动分类均待人工复核。", "", "## 目录", "",
  ];
  for (const chapter of dataset.chapters) lines.push(`- [第${chapter.number}回](#第${chapter.number}回)：${chapter.entryCount} 条`);
  lines.push("");
  for (const chapter of dataset.chapters) {
    lines.push(`## 第${chapter.number}回`, "");
    for (const entry of dataset.entries.filter((item) => item.chapter === chapter.number)) {
      const embedded = entry.embeddedIn.length ? `【嵌于${entry.embeddedIn.join("/")}】` : "";
      const anchor = entry.anchor ? `锚点「…${entry.anchor}」 → ` : "";
      lines.push(`${entry.ordinal}. ${entryMeta(entry)}${embedded}${anchor}${entry.comment}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

function generateTiered(dataset) {
  const lines = ["# 脂批分档全录（多见证来源）", "", "> 复合标签会同时保留多个见证本；本文件按最佳见证档位归组，不能据此直接判定批语内容真伪。", ""];
  const sections = [
    ...[1, 2, 3, 4].map((tier) => ({ title: TIER_NAMES[tier], items: dataset.entries.filter((entry) => entry.bestTier === tier) })),
    { title: "后出评论/现代校按", items: dataset.entries.filter((entry) => ["later-comment", "editorial"].includes(entry.sourceClass)) },
    { title: "未标注来源", items: dataset.entries.filter((entry) => entry.sourceClass === "unknown") },
  ];
  for (const section of sections) {
    lines.push(`## ${section.title}（${section.items.length} 条）`, "");
    for (const entry of section.items) {
      const anchor = entry.anchor ? `锚点「…${entry.anchor}」 → ` : "";
      lines.push(`- 【第${entry.chapter}回】【${entry.id}】【${sourceDisplay(entry)}】【${entry.sourceMode}】${anchor}${entry.comment}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

function generateAnalysis(dataset) {
  const lines = ["# 脂批分析全录（自动初分，待人工复核）", "", "> 每条允许多个内容标签，主分类只用于排序。简析说明该类材料应如何使用，不代表已经证实批语判断。", ""];
  const grouped = Map.groupBy(dataset.entries, (entry) => entry.primaryCategory);
  for (const category of CATEGORY_PRIORITY) {
    const entries = grouped.get(category) ?? [];
    if (!entries.length) continue;
    lines.push(`## ${category}（${entries.length} 条）`, "");
    for (const entry of entries) {
      const flags = entry.riskFlags.length ? entry.riskFlags.join("、") : "无自动风险标签";
      lines.push(`- 【第${entry.chapter}回】【${entry.id}】【${sourceDisplay(entry)}】${entry.comment}`);
      lines.push(`  - 分类：${entry.categories.join("、")}；风险：${flags}；简析：${entry.analysisNote}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

function generateForeshadow(dataset) {
  const entries = dataset.entries.filter((entry) => entry.categories.includes("伏线暗示"));
  const lines = [
    "# 脂批伏线摘录（自动初筛）", "",
    `> 共 ${entries.length} 条。全部为“疑似，待人工复核”；出现“后文”等字样不等于确有可验证伏线。`,
    "> 复核必须定位所批正文、寻找前八十回内呼应，并区分情节预示、文法泛论、批者猜测和情感抒发。", "",
  ];
  for (const entry of entries) {
    const anchor = entry.anchor ? `锚点「…${entry.anchor}」 → ` : "";
    lines.push(`- 【第${entry.chapter}回】【${entry.id}】【${sourceDisplay(entry)}】【${entry.riskFlags.join("、") || "待复核"}】${anchor}${entry.comment}`);
  }
  lines.push("");
  return lines.join("\n");
}

function generateReviewTask(dataset) {
  const entries = dataset.entries.filter((entry) => entry.categories.includes("伏线暗示"));
  const batches = [];
  for (let start = 1; start <= 80; start += 10) {
    const end = start + 9;
    batches.push({ start, end, count: entries.filter((entry) => entry.chapter >= start && entry.chapter <= end).length });
  }
  const lines = [
    "# 脂批伏线人工复核任务", "",
    `本轮共有 ${entries.length} 条自动候选。目标不是证明脂批正确，而是判断它具体批在何处、指向什么、在前八十回能否验证。`, "",
    "## 判定结果", "", "每条只能选择一个主结论：", "",
    "1. `已验证伏线`：能指出明确批点，并在 1-80 回找到具体呼应。",
    "2. `未完伏线`：指向八十回后，前八十回无法完成验证。",
    "3. `文法泛论`：只是讨论照应、章法或写法，没有具体情节命题。",
    "4. `批者猜测`：批语提出推断，但正文没有足够支持。",
    "5. `错位/疑似误抄`：批点正文与批语明显不合。",
    "6. `重复见证`：与同批点其他版本实为同一批语。",
    "7. `剔除`：情感抒发、泛赞或无法定位。", "",
    "## 每条输出字段", "", "```text", "ID：", "批点正文：", "版本见证：", "主结论：",
    "主题：人物 / 家族 / 婚姻 / 盛衰 / 诗谶 / 叙事结构 / 其他", "前八十回呼应：", "异文与错位：",
    "可信度：高 / 中 / 低", "说明：", "```", "", "## 分批", "",
    "| 批次 | 回目 | 候选数 | 状态 |", "|---|---:|---:|---|",
  ];
  for (const batch of batches) lines.push(`| ${String(batch.start).padStart(2, "0")}-${batch.end} | 第${batch.start}-${batch.end}回 | ${batch.count} | 待复核 |`);
  lines.push("", "## 使用约束", "",
    "- 不以版本档位代替内容判断；第一档批语也可能主观、误判或只针对局部。",
    "- 不用脂批反向证明按脂批续写的文本，避免循环论证。",
    "- 遇复合来源时分别记录各见证，不把“列、庚双夹”压成单一版本。",
    "- 引用前回到源码行号；重要结论还应核对影印本。", "");
  return lines.join("\n");
}

function generateReport(dataset) {
  const witnessCounts = countBy(dataset.entries, (entry) => entry.witnesses.map((witness) => witness.name));
  const categoryCounts = countBy(dataset.entries, (entry) => entry.primaryCategory);
  const riskCounts = countBy(dataset.entries.filter((entry) => entry.riskFlags.length), (entry) => entry.riskFlags);
  const sourceClassCounts = countBy(dataset.entries, (entry) => entry.sourceClass);
  const locusCounts = countBy(dataset.loci, (locus) => locus.status);
  const lines = [
    "# 脂批整理报告", "", "> 由 `npm run extract:zhipi` 生成；输出只由 1-80 回源码和整理规则决定。", "", "## 完整性", "",
    `- 回目：${dataset.scope.startChapter}-${dataset.scope.endChapter}，共 ${dataset.scope.chapterCount} 回。`,
    `- 源文 \`[zp]\`：${dataset.integrity.rawZpMarkerCount} 个。`, `- 提取记录：${dataset.integrity.extractedEntryCount} 条。`,
    `- 数量校验：${dataset.integrity.countsMatch ? "通过" : "失败"}。`, `- 批点位置：${dataset.loci.length} 处。`, "",
    "## 来源类型", "", "| 类型 | 条数 |", "|---|---:|",
    ...sourceClassCounts.map(([name, count]) => `| ${mdEscape(SOURCE_CLASS_NAMES[name] ?? name)} | ${count} |`), "",
    "## 版本见证", "", "> 复合来源会同时计入多个见证，因此合计可能大于总条数。", "", "| 见证 | 条数 |", "|---|---:|",
    ...witnessCounts.map(([name, count]) => `| ${mdEscape(name)} | ${count} |`), "",
    "## 主分类", "", "| 分类 | 条数 |", "|---|---:|",
    ...categoryCounts.map(([name, count]) => `| ${mdEscape(name)} | ${count} |`), "",
    "## 批点校合状态", "", "| 状态 | 批点数 |", "|---|---:|",
    ...locusCounts.map(([name, count]) => `| ${mdEscape(LOCUS_STATUS_NAMES[name] ?? name)} | ${count} |`), "",
    "## 风险标签", "", "| 风险 | 条数 |", "|---|---:|",
    ...riskCounts.map(([name, count]) => `| ${mdEscape(name)} | ${count} |`), "", "## 使用说明", "",
    "- 当前内容分类是关键词启发式初分，不是最终学术判断。",
    "- 版本档位只衡量见证本的传抄参考优先级，不能证明某条褒贬或预言为真。",
    "- `parallel-variant`/`mixed-locus` 只是文字相似度提示，不自动等于观点矛盾；`multi-comment-locus` 表示同处另有独立评论。",
    "- 来源不明、后出评论和现代校按已分开标记，仍需补书目与影印页码。",
    "- 结构化明细见 `脂批数据.json`，逐条简析见 `脂批分析全录.md`。", "",
  ];
  return lines.join("\n");
}

function writeOutputs(dataset) {
  if (!existsSync(RESEARCH_DIR)) {
    throw new Error("找不到 research/ 私有研究仓库；请先将 RedDream-Research 克隆到项目根目录的 research/。");
  }
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(OUTPUTS.full, generateFull(dataset), "utf8");
  writeFileSync(OUTPUTS.tiered, generateTiered(dataset), "utf8");
  writeFileSync(OUTPUTS.analysis, generateAnalysis(dataset), "utf8");
  writeFileSync(OUTPUTS.foreshadow, generateForeshadow(dataset), "utf8");
  writeFileSync(OUTPUTS.review, generateReviewTask(dataset), "utf8");
  writeFileSync(OUTPUTS.report, generateReport(dataset), "utf8");
  writeFileSync(OUTPUTS.data, `${JSON.stringify(dataset, null, 2)}\n`, "utf8");
}

function main() {
  const dataset = buildDataset();
  writeOutputs(dataset);
  const categoryCounts = countBy(dataset.entries, (entry) => entry.primaryCategory);
  console.log(`回目：${dataset.scope.chapterCount}`);
  console.log(`源标记：${dataset.integrity.rawZpMarkerCount}`);
  console.log(`提取条目：${dataset.integrity.extractedEntryCount}`);
  console.log(`批点：${dataset.loci.length}`);
  console.log(`主分类：${categoryCounts.map(([name, count]) => `${name}:${count}`).join(" ")}`);
  console.log(`已输出：${Object.values(OUTPUTS).join("、")}`);
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";
if (import.meta.url === invokedPath) main();
