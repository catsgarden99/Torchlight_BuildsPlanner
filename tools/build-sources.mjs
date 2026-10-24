#!/usr/bin/env node
/**
 * 自动来源生成：把「天赋 / 传奇装备 / 契灵 / 技能」里提到某个 buff 的文本，
 * 直接变成来源候选（data/sources-auto.js）。
 *
 * 为什么需要它：人工核实的来源（data/sources.js）只有几十条，而实际游戏里
 * 能拿到祝福/凌厉之类的渠道有成百上千条（天赋 1236、传奇 338、契灵 180…）。
 * 这里用关键字 + 句式把候选全捞出来，标 auto:true —— 只保证"文本提到了"，
 * 不保证语义，也不参与层数推导。
 *
 * 角色判定（保守）：
 *   含「上限」                    → modify（改上限，不是给层数）
 *   含「至少拥有 / 需要 / 时，/ 期间」→ consume（前置条件）
 *   含「获得 / 提供 / 给予 / 使」    → grant（真的给东西）
 *   其它                          → modify
 *
 * 用法：node tools/build-sources.mjs
 */
import { readdir, readFile, writeFile } from "node:fs/promises";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PARSED_DIR = path.join(ROOT, "data", "parsed");
const OUT = path.join(ROOT, "data", "sources-auto.js");

const PAGE_META = {
  Legendary_Gear: { kind: "legendary", label: "传奇装备", cost: { gearSlots: 1, load: "低" }, ref: "https://tlidb.com/cn/Legendary_Gear" },
  Talent: { kind: "talent", label: "天赋", cost: { talentPoints: 1, load: "低" }, ref: "https://tlidb.com/cn/Talent" },
  Pactspirit: { kind: "pactspirit", label: "契灵", cost: { load: "低" }, ref: "https://tlidb.com/cn/Pactspirit" },
  skills: { kind: "skill", label: "技能", cost: { skillSlots: 1, load: "低" }, ref: "https://tlidb.com/cn/Active_Skill" },
};

async function loadGlobals(files) {
  const sandbox = { window: {} };
  vm.createContext(sandbox);
  for (const file of files) {
    vm.runInContext(await readFile(path.join(ROOT, "data", file), "utf8"), sandbox, { filename: file });
  }
  return sandbox.window;
}

function buildTermTable(buffs) {
  const terms = [];
  for (const buff of buffs) {
    const words = new Set([buff.name, ...(buff.aliases || [])]);
    for (const word of [...words]) {
      const cleaned = String(word).replace(/[（(][^）)]*[）)]/g, "").trim();
      if (cleaned.length >= 2) {
        words.add(cleaned);
        words.add(cleaned.replace(/祝福$/, ""));
      }
    }
    for (const word of words) if (word.length >= 2) terms.push({ term: word, buffId: buff.id });
  }
  return terms.sort((a, b) => b.term.length - a.term.length);
}

function classify(text) {
  if (text.includes("上限")) return "modify";
  if (/至少拥有|需要|时才|期间|时，|时,/.test(text)) return "consume";
  if (/获得|提供|给予|使|\+1 层|层数 \+/.test(text)) return "grant";
  return "modify";
}

const { TLI_BUFFS: buffs, TLI_SKILLS: skillData, TLI_TALENTS: talentData, TLI_PACTSPIRITS: pactData } = await loadGlobals([
  "buffs.js",
  "skills.js",
  "talents.js",
  "pactspirits.js",
]);

const terms = buildTermTable(buffs);
const entries = [];
const seen = new Set();

function push(buffId, meta, text, extra) {
  const key = `${buffId}|${meta.page}|${meta.item}|${text}`;
  if (seen.has(key)) return;
  seen.add(key);
  const pageMeta = PAGE_META[meta.page] || { kind: "unknown", label: meta.page, cost: { load: "中" }, ref: "" };
  const role = classify(text);
  entries.push({
    id: "auto." + buffId + "." + (meta.id || entries.length) + "." + meta.page,
    name: (meta.item || "（未命名）") + "（" + pageMeta.label + "）",
    kind: pageMeta.kind,
    buffIds: [buffId],
    role,
    auto: true,
    effect: { mode: "none" },
    text,
    value: role === "grant" ? "自动候选：文本显示可获得" : role === "consume" ? "自动候选：前置/条件" : "自动候选：数值/上限影响",
    cost: { ...pageMeta.cost },
    constraints: meta.constraint ? [meta.constraint] : [],
    ref: pageMeta.ref,
    verified: false,
    incomplete: true,
  });
}

// 天赋：每个节点最多取前 3 条相关行，避免一条节点刷出一堆条目
for (const talent of talentData?.entries || []) {
  let used = 0;
  for (const line of talent.lines || []) {
    const hits = terms.filter((t) => line.text.includes(t.term));
    if (hits.length === 0) continue;
    const uniqueBuffIds = [...new Set(hits.map((h) => h.buffId))];
    for (const buffId of uniqueBuffIds) {
      push(buffId, { page: "Talent", item: talent.name, id: talent.id, constraint: talent.kind + (talent.tree ? " · " + talent.tree.name : "") }, line.text);
    }
    used += 1;
    if (used >= 3) break;
  }
}

// 传奇装备（来自 parsed/Legendary_Gear.json）
try {
  const legendary = JSON.parse(await readFile(path.join(PARSED_DIR, "Legendary_Gear.json"), "utf8"));
  for (const item of legendary.items) {
    for (const mod of item.mods) {
      const hits = terms.filter((t) => mod.text.includes(t.term));
      for (const buffId of [...new Set(hits.map((h) => h.buffId))]) {
        push(buffId, { page: "Legendary_Gear", item: item.name, id: mod.id, constraint: item.category }, mod.text);
      }
    }
  }
} catch (error) {
  console.warn("传奇装备解析跳过：" + error.message);
}

// 契灵
for (const spirit of pactData?.spirits || []) {
  for (const mod of spirit.modifiers || []) {
    const hits = terms.filter((t) => mod.includes(t.term));
    for (const buffId of [...new Set(hits.map((h) => h.buffId))]) {
      push(buffId, { page: "Pactspirit", item: spirit.name, id: spirit.slug, constraint: "契灵位" }, mod);
    }
  }
}

// 技能
for (const skill of skillData?.skills || []) {
  for (const line of skill.lines || []) {
    const hits = terms.filter((t) => line.includes(t.term));
    for (const buffId of [...new Set(hits.map((h) => h.buffId))]) {
      push(buffId, { page: "skills", item: skill.name, id: skill.slug }, line);
    }
  }
}

await writeFile(
  OUT,
  `// 自动生成，勿手改。来源：tools/build-sources.mjs（关键字匹配 + 句式分类，未经人工核实）\nwindow.TLI_SOURCES_AUTO = ${JSON.stringify(
    { generatedAt: new Date().toISOString(), count: entries.length, entries },
    null,
    1
  )};\n`,
  "utf8"
);

const byBuff = {};
const byRole = {};
for (const entry of entries) {
  byBuff[entry.buffIds[0]] = (byBuff[entry.buffIds[0]] || 0) + 1;
  byRole[entry.role] = (byRole[entry.role] || 0) + 1;
}
console.log(`自动来源 ${entries.length} 条 → ${path.relative(ROOT, OUT)}`);
console.log("  按角色：" + JSON.stringify(byRole));
console.log("  按 buff：" + JSON.stringify(byBuff));
