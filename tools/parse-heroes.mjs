#!/usr/bin/env node
/**
 * 英雄特性解析。tlidb 的英雄页结构（已核实）：
 *
 *   <div class="fw-bold" data-id="720001">寻仇之刺</div>需求等级 1<hr/>
 *   <div data-tier-content="1">
 *     <div class="tierLevel active">等级 1</div>
 *     <div>
 *       <div data-src="affix">释放寻仇后，获得凌厉<br/>…</div>
 *       <div data-src="server_affix">将第三个技能槽位的技能替换为寻仇</div>
 *     </div>
 *   </div>
 *   <div data-tier-content="2">…</div>   ← 同一特性的不同等级
 *
 * 输出：data/heroes.js（window.TLI_HEROES）
 * 用法：node tools/parse-heroes.mjs
 */
import { readdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RAW_DIR = path.join(ROOT, "data", "raw");
const OUT_FILE = path.join(ROOT, "data", "heroes.js");

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

function parseTraits(html) {
  const traits = [];
  const marker = /<div class="fw-bold" data-id="(\d+)">([\s\S]*?)<\/div>/g;
  const marks = [];
  let match;
  while ((match = marker.exec(html)) !== null) {
    marks.push({ id: match[1], name: stripTags(match[2]), index: match.index, end: marker.lastIndex });
  }
  for (let i = 0; i < marks.length; i += 1) {
    const mark = marks[i];
    const stop = i + 1 < marks.length ? marks[i + 1].index : Math.min(html.length, mark.end + 12000);
    const chunk = html.slice(mark.end, stop);
    const reqMatch = chunk.match(/需求等级\s*(\d+)/);
    const tiers = [];
    const parts = chunk.split('<div data-tier-content="');
    for (let p = 1; p < parts.length; p += 1) {
      const part = parts[p];
      const levelMatch = part.match(/^(\d+)"/);
      const affixMatch = part.match(/<div data-src="affix">([\s\S]*?)<\/div>/);
      const serverMatch = part.match(/<div data-src="server_affix">([\s\S]*?)<\/div>/);
      const affix = affixMatch ? stripTags(affixMatch[1]) : "";
      const server = serverMatch ? stripTags(serverMatch[1]) : "";
      if (!affix && !server) continue;
      tiers.push({
        level: levelMatch ? Number(levelMatch[1]) : tiers.length + 1,
        affixLines: affix ? affix.split("\n") : [],
        serverLines: server ? server.split("\n") : [],
      });
    }
    if (tiers.length === 0) continue;
    traits.push({ id: mark.id, name: mark.name, reqLevel: reqMatch ? Number(reqMatch[1]) : null, tiers });
  }
  return traits;
}

async function main() {
  const files = (await readdir(RAW_DIR)).filter((name) => name.endsWith(".html") && !name.startsWith("_"));
  const heroes = [];
  for (const file of files.sort()) {
    const html = await readFile(path.join(RAW_DIR, file), "utf8");
    if (!html.includes('data-tier-content="')) continue;
    const traits = parseTraits(html);
    if (traits.length === 0) continue;
    const identity = html.match(/<a href="([A-Za-z0-9_]+)">([^<]*\|[^<]*)<\/a>/);
    heroes.push({
      slug: path.basename(file, ".html"),
      titled: identity ? stripTags(identity[2]) : null,
      heroSlug: identity ? identity[1] : null,
      traits,
    });
  }

  await writeFile(
    OUT_FILE,
    `// 自动生成，勿手改。来源：tools/parse-heroes.mjs\nwindow.TLI_HEROES = ${JSON.stringify({ generatedAt: new Date().toISOString(), count: heroes.length, heroes }, null, 1)};\n`,
    "utf8"
  );

  console.log(`英雄页面 ${heroes.length} 个 → ${path.relative(ROOT, OUT_FILE)}`);
  for (const hero of heroes) {
    console.log(`  ${hero.slug}（${hero.titled || "?"}）：${hero.traits.map((trait) => trait.name).join(" / ")}`);
  }
}

await main();
