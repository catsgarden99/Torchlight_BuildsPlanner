#!/usr/bin/env node
/**
 * 技能解析：tlidb 的技能页有两种形态。
 *
 * 1) 列表页（Active_Skill / Support_Skill / …）
 *    <div class="col"><div class="d-flex border-top rounded">
 *      <a href="Crescent_Slash">碎月弧光斩</a>
 *      <span data-skilltagid="Melee" data-filter="近战">近战</span>, …
 *
 * 2) 详情页（Crescent_Slash 等）
 *    <div class="explicitMod">连携起手1：向前斩出一道剑气，造成 <span class="text-mod">502%</span> 武器攻击伤害。</div>
 *
 * 输出：data/skills.js（window.TLI_SKILLS）——供索引与界面共用。
 * 用法：node tools/parse-skills.mjs
 */
import { readdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const RAW_DIR = path.join(ROOT, "data", "raw");
const OUT_FILE = path.join(ROOT, "data", "skills.js");

const LIST_PAGES = new Set([
  "Active_Skill", "Support_Skill", "Passive_Skill", "Activation_Medium_Skill",
  "Magnificent_Support_Skill", "Noble_Support_Skill", "Modularization_Skill",
  "Tartarus_Skill", "Origin_Tartarus_Skill", "Aura",
]);

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
    .trim();
}

function parseListPage(html) {
  const entries = [];
  const blocks = html.split('<div class="col">').slice(1);
  for (const block of blocks) {
    const nameMatch = block.match(/<a\b[^>]*href="([A-Za-z0-9_%.-]+)"[^>]*>\s*([^<]{1,40})\s*<\/a>/);
    if (!nameMatch) continue;
    const tags = [];
    const tagPattern = /<span\s+data-skilltagid="([^"]+)"[^>]*>([^<]*)<\/span>/g;
    let tagMatch;
    while ((tagMatch = tagPattern.exec(block)) !== null) {
      tags.push({ id: tagMatch[1], label: stripTags(tagMatch[2]) || tagMatch[1] });
    }
    const name = stripTags(nameMatch[2]);
    if (!name) continue;
    entries.push({ slug: nameMatch[1], name, tags, lines: [] });
  }
  return entries;
}

function parseDetailPage(html, slug) {
  const lines = [];
  const modPattern = /<div class="explicitMod">([\s\S]*?)<\/div>/g;
  let match;
  while ((match = modPattern.exec(html)) !== null) {
    const text = stripTags(match[1]);
    if (text.length > 0) {
      // 一个 explicitMod 里可能有多行（<br> / 嵌套块），逐行入库
      for (const line of text.split("\n")) {
        const trimmed = line.trim();
        if (trimmed.length > 0) lines.push(trimmed);
      }
    }
  }
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const tags = [];
  const tagPattern = /<span\s+data-skilltagid="([^"]+)"[^>]*>([^<]*)<\/span>/g;
  let tagMatch;
  while ((tagMatch = tagPattern.exec(html)) !== null) {
    tags.push({ id: tagMatch[1], label: stripTags(tagMatch[2]) || tagMatch[1] });
  }
  return { slug, name: null, title: titleMatch ? stripTags(titleMatch[1]) : null, tags, lines };
}

async function main() {
  const files = (await readdir(RAW_DIR)).filter((name) => name.endsWith(".html") && !name.startsWith("_"));
  const bySlug = new Map();

  for (const file of files) {
    const slug = path.basename(file, ".html");
    const html = await readFile(path.join(RAW_DIR, file), "utf8");
    if (LIST_PAGES.has(slug)) {
      for (const entry of parseListPage(html)) {
        if (!bySlug.has(entry.slug)) bySlug.set(entry.slug, { ...entry, listPages: [slug] });
        else bySlug.get(entry.slug).listPages.push(slug);
      }
      continue;
    }
    if (/<div class="explicitMod">/.test(html)) {
      const detail = parseDetailPage(html, slug);
      const existing = bySlug.get(slug);
      if (existing) {
        existing.lines = detail.lines;
        existing.detailPage = true;
        if (detail.tags.length > 0 && existing.tags.length === 0) existing.tags = detail.tags;
      } else {
        bySlug.set(slug, { slug, name: detail.title, tags: detail.tags, lines: detail.lines, detailPage: true, listPages: [] });
      }
    }
  }

  const skills = [...bySlug.values()].sort((a, b) => a.slug.localeCompare(b.slug));
  const withLines = skills.filter((skill) => skill.lines.length > 0);
  await writeFile(
    OUT_FILE,
    `// 自动生成，勿手改。来源：tools/parse-skills.mjs\nwindow.TLI_SKILLS = ${JSON.stringify({ generatedAt: new Date().toISOString(), count: skills.length, skills }, null, 1)};\n`,
    "utf8"
  );

  console.log(`技能条目 ${skills.length} 个（其中 ${withLines.length} 个有详情文本）→ ${path.relative(ROOT, OUT_FILE)}`);
  const focus = skills.find((skill) => skill.slug === "Crescent_Slash");
  if (focus) {
    console.log(`\n碎月弧光斩（Crescent_Slash）：标签 ${focus.tags.map((tag) => tag.label).join("/") || "（无）"}`);
    for (const line of focus.lines.slice(0, 6)) console.log(`  · ${line}`);
  }
}

await main();
