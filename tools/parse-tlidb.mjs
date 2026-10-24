#!/usr/bin/env node
/**
 * 阶段 C-1：把 data/raw/*.html 解析成结构化 JSON（data/parsed/<slug>.json）。
 *
 * tlidb 的实际结构（已用 tools/inspect-html.mjs 核实）：
 *   <div class="col"><div class="border-top rounded p-2">
 *     <div class="d-flex justify-content-between mb-2">
 *       <span>双手剑</span>                       ← 装备分类
 *       <span><a href="Will" class="item_rarity100">决意</a> <span class="corroded-mod">已侵蚀</span></span>
 *     </div>
 *     <div class="card-text">
 *       <span data-modifier-id="51230631">        ← 一条词条（modifier id 稳定，可做跨赛季 diff）
 *         <span class="tier tier1"></span>至少拥有 <span class="text-mod">6</span> 层任意<e ...>祝福</e>时，…
 *       </span>
 *     </div>
 *   </div></div>
 *
 * 处理策略：先按 <div class="col"> 切块（卡片式页面），块内取「分类 / 名称 / 侵蚀 / 所有 data-modifier-id 词条」；
 * 块数过少时退回按 <tr> 切块（表格式页面，如 Craft / Talent）。表格式页面没有「名称」时，名称留空但词条照收。
 *
 * 用法：
 *   node tools/parse-tlidb.mjs               # 全部 raw 页面
 *   node tools/parse-tlidb.mjs Blessing Aura # 指定页面 slug
 */
import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const RAW_DIR = path.join(ROOT, "data", "raw");
const OUT_DIR = path.join(ROOT, "data", "parsed");

const ENTITIES = {
  "&ndash;": "–", "&mdash;": "—", "&amp;": "&", "&lt;": "<", "&gt;": ">",
  "&quot;": '"', "&apos;": "'", "&#39;": "'", "&nbsp;": " ", "&hellip;": "…", "&times;": "×",
};

function decodeEntities(text) {
  return text
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&[a-zA-Z]+;/g, (match) => (ENTITIES[match] !== undefined ? ENTITIES[match] : match));
}

function stripTags(html) {
  return decodeEntities(
    html
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<[^>]+>/g, "")
  )
    .replace(/[ \t\u00a0]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .trim();
}

/** 从 startIndex 起的 <span ...> 取出配平的完整片段 */
function sliceBalancedSpan(html, startIndex) {
  const opener = /<span\b[^>]*>|<\/span>/gi;
  opener.lastIndex = startIndex;
  let depth = 0;
  let match;
  while ((match = opener.exec(html)) !== null) {
    if (match[0][1] === "/") {
      depth -= 1;
      if (depth === 0) return html.slice(startIndex, match.index + match[0].length);
    } else {
      depth += 1;
    }
  }
  return html.slice(startIndex, Math.min(html.length, startIndex + 1200));
}

function extractMods(blockHtml) {
  const mods = [];
  const pattern = /<span\s+data-modifier-id="(\d+)"[^>]*>/g;
  let match;
  while ((match = pattern.exec(blockHtml)) !== null) {
    const full = sliceBalancedSpan(blockHtml, match.index);
    const tierMatch = full.match(/class="tier\s+tier(\d)"/);
    const text = stripTags(full);
    if (text.length === 0) continue;
    mods.push({
      id: match[1],
      tier: tierMatch ? Number(tierMatch[1]) : null,
      text,
    });
  }
  return mods;
}

function firstMatch(html, regexes) {
  for (const regex of regexes) {
    const match = html.match(regex);
    if (match) return match;
  }
  return null;
}

/** 卡片式：<div class="col"> 块 */
function parseCardBlocks(html) {
  const blocks = html.split('<div class="col">').slice(1);
  const items = [];
  for (const block of blocks) {
    const nameMatch = firstMatch(block, [
      /<a\b[^>]*class="[^"]*item_rarity[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/,
      /<a\b[^>]*href="([^"]+)"[^>]*class="[^"]*item_rarity[^"]*"[^>]*>([\s\S]*?)<\/a>/,
      /<a\b[^>]*href="([^"]+)"[^>]*class="[^"]*(?:ui_item|item)[^"]*"[^>]*>([\s\S]*?)<\/a>/,
    ]);
    const categoryMatch = block.match(/<span>([^<]{1,20})<\/span>/);
    const mods = extractMods(block);
    if (mods.length === 0) continue;
    items.push({
      name: nameMatch ? stripTags(nameMatch[2]) : null,
      slug: nameMatch ? nameMatch[1] : null,
      category: categoryMatch ? stripTags(categoryMatch[1]) : null,
      corroded: /corroded-mod/.test(block),
      mods,
    });
  }
  return items;
}

/** 表格式：<tr> 块（Craft / Talent / Divinity_Slate 等）
 *  这些表格通常是三列：[词缀效果] [来源] [类型]，例如 Craft：
 *    <td><span data-modifier-id="…">攻击附加 …</span></td><td>爪</td><td>基础词缀</td>
 *  所以「名字」要取第二列（来源/槽位），「分类」取第三列（类型），否则整库都会是未标注条目。
 */
function parseTableRows(html) {
  const rows = html.split("<tr>").slice(1);
  const items = [];
  for (const row of rows) {
    const mods = extractMods(row);
    if (mods.length === 0) continue;
    const cells = [];
    const cellPattern = /<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/g;
    let cellMatch;
    while ((cellMatch = cellPattern.exec(row)) !== null) cells.push(stripTags(cellMatch[1]));
    const linkMatch = row.match(/<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
    // 第一列若就是词条本身，则名字来自第二列（来源），分类来自第三列（类型）
    const firstName = cells[1] && cells[1].length > 0 && cells[1].length <= 40 ? cells[1] : null;
    items.push({
      name: firstName || (linkMatch ? stripTags(linkMatch[2]) : null),
      slug: linkMatch ? linkMatch[1] : null,
      category: cells[2] && cells[2].length > 0 && cells[2].length <= 40 ? cells[2] : null,
      corroded: /corroded-mod/.test(row),
      mods,
    });
  }
  return items;
}

/** 「词缀 /2526」→「词缀」 */
function cleanSectionHeader(text) {
  return String(text || "")
    .replace(/\s*\/\s*\d+\s*$/, "")
    .trim();
}

async function parsePage(file) {
  const html = await readFile(file, "utf8");
  const slug = path.basename(file, ".html");
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);

  // 按 card-header 分段：段标题（例如「词缀」「打造」）可以作为没有名字的条目的兜底标注，
  // 避免整页条目都显示成「未标注条目」。
  const rawSections = html.split(/<div class="card-header">/);
  rawSections.shift(); // 第一个 header 之前的导航区
  const items = [];
  let usedTable = false;
  let usedCard = false;

  for (const section of rawSections) {
    const headerEnd = section.indexOf("</div>");
    const header = cleanSectionHeader(stripTags(section.slice(0, headerEnd)));

    let part = parseCardBlocks(section);
    if (part.length > 0) usedCard = true;
    const tablePart = parseTableRows(section);
    if (tablePart.length > part.length) {
      part = tablePart;
      usedTable = true;
    }
    for (const item of part) {
      if (!item.name && header) item.name = header;
      items.push(item);
    }
  }

  let layout = usedTable && usedCard ? "mixed" : usedTable ? "table" : "card";
  if (items.length === 0) {
    // 兜底：整页当作一个块，至少不丢词条
    const mods = extractMods(html);
    if (mods.length > 0) {
      items.push({ name: null, slug: null, category: null, corroded: false, mods });
      layout = "document";
    }
  }

  const modCount = items.reduce((sum, item) => sum + item.mods.length, 0);
  const unnamed = items.filter((item) => !item.name).length;
  return {
    page: slug,
    title: titleMatch ? stripTags(titleMatch[1]) : null,
    layout,
    items,
    modCount,
    unnamed,
  };
}

async function main() {
  const only = process.argv.slice(2).filter((arg) => !arg.startsWith("--"));
  const names = (await readdir(RAW_DIR)).filter((name) => name.endsWith(".html") && !name.startsWith("_"));
  const targets = only.length > 0 ? names.filter((name) => only.includes(path.basename(name, ".html"))) : names;
  if (targets.length === 0) {
    console.error("没有可解析的页面");
    process.exitCode = 2;
    return;
  }
  await mkdir(OUT_DIR, { recursive: true });

  const summary = [];
  for (const name of targets.sort()) {
    const parsed = await parsePage(path.join(RAW_DIR, name));
    await writeFile(path.join(OUT_DIR, `${parsed.page}.json`), JSON.stringify(parsed, null, 1), "utf8");
    summary.push(parsed);
    console.log(
      `${parsed.page.padEnd(28)} ${String(parsed.layout).padEnd(8)} 条目 ${String(parsed.items.length).padStart(5)}  词条 ${String(parsed.modCount).padStart(6)}  未标注 ${String(parsed.unnamed).padStart(4)}`
    );
  }

  const totalItems = summary.reduce((sum, page) => sum + page.items.length, 0);
  const totalMods = summary.reduce((sum, page) => sum + page.modCount, 0);
  const totalUnnamed = summary.reduce((sum, page) => sum + page.unnamed, 0);
  console.log(
    `\n合计：${summary.length} 页，${totalItems} 条目，${totalMods} 条词条，未标注 ${totalUnnamed} 条目` +
      (totalItems > 0 ? `（${((totalUnnamed / totalItems) * 100).toFixed(1)}%）` : "") +
      ` → ${path.relative(ROOT, OUT_DIR)}`
  );
}

await main();
