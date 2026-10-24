#!/usr/bin/env node
/**
 * 阶段 C-2：把 data/parsed/*.json 变成「buff ← 词条」的反向索引，输出 data/index.js。
 *
 * 这是整个工具最核心的一步：只要有一条词条文本里出现了 buff 的词，它就算一条“来源候选”。
 * 例如「至少拥有 6 层任意祝福时…」会被记到「任意祝福」名下，并带上装备名、页面、原始词条文本。
 *
 * 用法：node tools/build-index.mjs
 */
import { readdir, readFile, writeFile } from "node:fs/promises";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import path from "node:path";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const PARSED_DIR = path.join(ROOT, "data", "parsed");
const OUT_FILE = path.join(ROOT, "data", "index.js");

const MAX_SAMPLES = 40;

/** 在 vm 里跑 data/*.js，取出挂在 window 上的全局 */
async function loadGlobals(files) {
  const sandbox = { window: {} };
  vm.createContext(sandbox);
  for (const file of files) {
    const code = await readFile(path.join(ROOT, "data", file), "utf8");
    vm.runInContext(code, sandbox, { filename: file });
  }
  return sandbox.window;
}

/** 词条里可能出现的写法 → buff id。长词优先，避免「祝福」吃掉「聚能祝福」。 */
function buildTermTable(buffs) {
  const terms = [];
  for (const buff of buffs) {
    const words = new Set([buff.name, ...(buff.aliases || [])]);
    // 去掉括号注释，例如「任意祝福（聚合）」→「任意祝福」
    for (const word of [...words]) {
      const cleaned = String(word).replace(/[（(][^）)]*[）)]/g, "").trim();
      if (cleaned.length >= 2) {
        words.add(cleaned);
        words.add(cleaned.replace(/祝福$/, "")); // 「聚能祝福」→「聚能」
      }
    }
    for (const word of words) {
      if (word.length < 2) continue;
      terms.push({ term: word, buffId: buff.id });
    }
  }
  return terms.sort((a, b) => b.term.length - a.term.length);
}

async function main() {
  const { TLI_BUFFS: buffs, TLI_SKILLS: skillData } = await loadGlobals(["buffs.js", "skills.js"]);
  if (!buffs) throw new Error("data/buffs.js 没有导出 TLI_BUFFS");

  const files = (await readdir(PARSED_DIR)).filter((name) => name.endsWith(".json"));
  if (files.length === 0) throw new Error("data/parsed 为空，先跑 tools/parse-tlidb.mjs");

  const terms = buildTermTable(buffs);
  const byBuff = new Map(buffs.map((buff) => [buff.id, { count: 0, byPage: {}, samples: [], seen: new Set() }]));
  let scannedMods = 0;
  let matchedMods = 0;

  /** 一条文本 → 命中哪些 buff（长词优先，避免「祝福」吃掉「聚能祝福」） */
  function record(text, meta) {
    if (!text || text.length === 0) return;
    const hitBuffIds = new Set();
    for (const { term, buffId } of terms) {
      if (!hitBuffIds.has(buffId) && text.includes(term)) hitBuffIds.add(buffId);
    }
    if (hitBuffIds.size === 0) return;
    matchedMods += 1;
    for (const buffId of hitBuffIds) {
      const bucket = byBuff.get(buffId);
      if (!bucket) continue;
      bucket.count += 1;
      bucket.byPage[meta.page] = (bucket.byPage[meta.page] || 0) + 1;
      const key = `${meta.item || ""}|${text}`;
      if (bucket.seen.size < MAX_SAMPLES && !bucket.seen.has(key)) {
        bucket.seen.add(key);
        bucket.samples.push({ ...meta, text });
      }
    }
  }

  for (const file of files.sort()) {
    const page = JSON.parse(await readFile(path.join(PARSED_DIR, file), "utf8"));
    for (const item of page.items) {
      for (const mod of item.mods) {
        scannedMods += 1;
        record(mod.text, {
          page: page.page,
          item: item.name,
          slug: item.slug,
          category: item.category,
          corroded: item.corroded,
          tier: mod.tier,
          modId: mod.id,
          kind: "mod",
        });
      }
    }
  }

  // 技能文本也进索引：很多 buff 只写在技能描述里（例如「月晕」只出现在主技能上）
  if (skillData && Array.isArray(skillData.skills)) {
    for (const skill of skillData.skills) {
      for (const line of skill.lines || []) {
        scannedMods += 1;
        record(line, {
          page: "skills",
          item: skill.name,
          slug: skill.slug,
          category: (skill.tags || []).map((tag) => tag.label).join("/"),
          corroded: false,
          tier: null,
          modId: null,
          kind: "skill",
        });
      }
    }
  }

  const items = buffs.map((buff) => {
    const bucket = byBuff.get(buff.id);
    return {
      buffId: buff.id,
      count: bucket.count,
      byPage: bucket.byPage,
      samples: bucket.samples,
    };
  });

  const payload = {
    generatedAt: new Date().toISOString(),
    pages: files.length,
    scannedMods,
    matchedMods,
    items,
  };
  await writeFile(
    OUT_FILE,
    `// 自动生成，勿手改。来源：tools/build-index.mjs\nwindow.TLI_INDEX = ${JSON.stringify(payload, null, 1)};\n`,
    "utf8"
  );

  console.log(`扫描 ${scannedMods} 条词条，命中 ${matchedMods} 条（${((matchedMods / scannedMods) * 100).toFixed(1)}%）`);
  for (const item of items.sort((a, b) => b.count - a.count)) {
    const pages = Object.entries(item.byPage)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([page, count]) => `${page}:${count}`)
      .join(" ");
    console.log(`  ${item.buffId.padEnd(28)} ${String(item.count).padStart(6)}  ${pages}`);
  }
  console.log(`\n→ ${path.relative(ROOT, OUT_FILE)}`);
}

await main();
