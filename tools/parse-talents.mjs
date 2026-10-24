#!/usr/bin/env node
/**
 * 天赋解析。tlidb 的 Talent 页分三个 tab（tab-pane），结构相同：
 *
 *   <span class="fw-bold" data-id="700021">万界如常</span>
 *   <span><a href="New_God">新神</a></span>          ← 所属天赋树
 *   <div data-source="attr">每 <span class="text-mod">3</span> 秒获得 1 点秩序值</div>
 *   （神格生效上限：1）
 *
 * 输出：data/talents.js（window.TLI_TALENTS）
 * 用法：node tools/parse-talents.mjs
 */
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RAW = path.join(ROOT, "data", "raw", "Talent.html");
const OUT = path.join(ROOT, "data", "talents.js");

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

function main(html) {
  const tabPattern = /<div id="([^"]+)" class="tab-pane/g;
  const tabs = [];
  let tabMatch;
  while ((tabMatch = tabPattern.exec(html)) !== null) {
    tabs.push({ name: tabMatch[1], index: tabMatch.index });
  }

  const entries = [];
  for (let i = 0; i < tabs.length; i += 1) {
    const tab = tabs[i];
    const end = i + 1 < tabs.length ? tabs[i + 1].index : html.length;
    const body = html.slice(tab.index, end);
    if (!/data-id=/.test(body)) continue;

    const marker = /<(?:span|div)[^>]*data-id="(\d+)"[^>]*>([\s\S]*?)<\/(?:span|div)>/g;
    const marks = [];
    let match;
    while ((match = marker.exec(body)) !== null) {
      const name = stripTags(match[2]);
      if (!name || name.length > 40) continue;
      marks.push({ id: match[1], name, start: match.index, end: marker.lastIndex });
    }
    for (let m = 0; m < marks.length; m += 1) {
      const mark = marks[m];
      const stop = m + 1 < marks.length ? marks[m + 1].start : Math.min(body.length, mark.end + 1500);
      const chunk = body.slice(mark.end, stop);
      const tree = chunk.match(/<a href="([A-Za-z0-9_%.-]+)">([^<]{1,20})<\/a>/);
      const lines = [];
      const linePattern = /<div data-source="([^"]+)">([\s\S]*?)<\/div>/g;
      let lineMatch;
      while ((lineMatch = linePattern.exec(chunk)) !== null) {
        const text = stripTags(lineMatch[2]);
        if (text) lines.push({ source: lineMatch[1], text });
      }
      // 尾部括号说明（例如「（神格生效上限：1）」）
      const tail = chunk.replace(/<div data-source="[^"]*">[\s\S]*?<\/div>/g, " ");
      const tailText = stripTags(tail).split("\n").find((line) => /^[（(]/.test(line));
      // 同一节点会在多个 tab 里重复出现（核心天赋点 ⊂ 天赋），按 id 去重，保留信息更全的一份
      const existing = entries.find((entry) => entry.id === mark.id);
      const next = {
        id: mark.id,
        kind: tab.name,
        name: mark.name,
        tree: tree ? { slug: tree[1], name: stripTags(tree[2]) } : null,
        lines,
        note: tailText || null,
      };
      if (existing === undefined) entries.push(next);
      else if (existing.lines.length < lines.length) Object.assign(existing, next);
    }
  }
  return { generatedAt: new Date().toISOString(), count: entries.length, entries };
}

const payload = main(await readFile(RAW, "utf8"));
await writeFile(
  OUT,
  `// 自动生成，勿手改。来源：tools/parse-talents.mjs\nwindow.TLI_TALENTS = ${JSON.stringify(payload, null, 1)};\n`,
  "utf8"
);

const byKind = {};
for (const entry of payload.entries) byKind[entry.kind] = (byKind[entry.kind] || 0) + 1;
console.log(`天赋条目 ${payload.count} 个 → ${path.relative(ROOT, OUT)}`);
for (const [kind, count] of Object.entries(byKind)) console.log(`  ${kind}: ${count}`);
const sample = payload.entries.find((entry) => entry.lines.length > 0);
console.log(`  样例：${sample.name}（${sample.kind}）→ ${sample.lines.map((line) => line.text).join(" | ")}`);
