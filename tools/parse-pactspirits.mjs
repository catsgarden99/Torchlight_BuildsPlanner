#!/usr/bin/env node
/**
 * 契灵解析。tlidb Pactspirit 页的卡片结构（已核实）：
 *
 *   <div class="col"><div class="d-flex border-top rounded">
 *     <img class="pactspirit_smallicon ui_item_quality2">
 *     <div class="flex-grow-1 mx-2 my-1">
 *       <a data-hover="…" href="Awooawoo_-_Violet" class="item_rarity2">啊呜啊呜-罗兰</a>
 *       <div>攻击 <span class="item_rarity2">魔法</span></div>   ← 标签
 *       <div>增加攻击伤害，攻击暴击，攻击速度</div>              ← 说明
 *       <div class="border-top">
 *         <div class="modifier">额外 +7% 伤害；…</div>            ← 词条
 *
 * 输出：data/pactspirits.js（window.TLI_PACTSPIRITS）
 * 用法：node tools/parse-pactspirits.mjs
 */
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RAW = path.join(ROOT, "data", "raw", "Pactspirit.html");
const OUT = path.join(ROOT, "data", "pactspirits.js");

const ENTITIES = { "&ndash;": "–", "&mdash;": "—", "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&nbsp;": " " };

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
      .replace(/<\/(?:div|p|li)>/gi, "\n")
      .replace(/<[^>]+>/g, "")
  )
    .replace(/[ \t\u00a0]+/g, " ")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join("\n");
}

const html = await readFile(RAW, "utf8");
const blocks = html.split('<div class="col">').slice(1);
const spirits = [];

for (const block of blocks) {
  const nameMatch = block.match(/<a\b[^>]*href="([^"]+)"[^>]*class="[^"]*item_rarity[^"]*"[^>]*>([\s\S]*?)<\/a>/);
  if (!nameMatch) continue;

  const modifiers = [];
  const modPattern = /<div class="modifier">([\s\S]*?)<\/div>/g;
  let modMatch;
  while ((modMatch = modPattern.exec(block)) !== null) {
    const text = stripTags(modMatch[1]);
    if (text) modifiers.push(text);
  }
  if (modifiers.length === 0) continue;

  // 名称之后的两行：标签行（含 item_rarity span）与说明行
  const afterName = block.slice(nameMatch.index + nameMatch[0].length);
  const simpleDivs = [...afterName.matchAll(/<div>([\s\S]*?)<\/div>/g)].map((match) => stripTags(match[1])).filter(Boolean);
  const tags = simpleDivs[0] ? simpleDivs[0].split(/\s+/).filter(Boolean) : [];
  const desc = simpleDivs[1] || null;

  spirits.push({
    slug: nameMatch[1],
    name: stripTags(nameMatch[2]),
    tags,
    desc,
    modifiers,
  });
}

await writeFile(
  OUT,
  `// 自动生成，勿手改。来源：tools/parse-pactspirits.mjs\nwindow.TLI_PACTSPIRITS = ${JSON.stringify({ generatedAt: new Date().toISOString(), count: spirits.length, spirits }, null, 1)};\n`,
  "utf8"
);

console.log(`契灵 ${spirits.length} 个 → ${path.relative(ROOT, OUT)}`);
const modCount = spirits.reduce((sum, spirit) => sum + spirit.modifiers.length, 0);
console.log(`  词条合计 ${modCount} 条，样例：${spirits[0].name}（${spirits[0].tags.join("/")}）→ ${spirits[0].modifiers[0]}`);
