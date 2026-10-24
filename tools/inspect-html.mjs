#!/usr/bin/env node
/**
 * 阶段 B：HTML 结构探测。先看清楚，再写解析器。
 *
 * 用法：
 *   node tools/inspect-html.mjs data/raw/Blessing.html
 *   node tools/inspect-html.mjs data/raw            # 整目录，输出汇总
 *
 * 输出：
 *   - 控制台摘要（标签直方图、class 频次）
 *   - data/raw/_inspect-<文件名>.md  详细报告（含候选容器样本），给人和 AI 一起看
 *
 * 这里不做"猜测性提取"：只报事实（哪个 class 出现多少次、样本长什么样），
 * 具体字段映射留到 tools/parse-*.mjs 里，由看过报告的人决定。
 */
import { readdir, readFile, writeFile, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");

const NOISE_TAGS = new Set(["script", "style", "noscript", "svg", "path", "link", "meta", "br", "hr"]);
const WANT_KEYS = [
  "item", "newItem", "itemName", "itemLevel", "mod", "mods", "explicitMod", "implicitMod",
  "affix", "property", "propertyText", "skill", "card", "panel", "box", "row", "entry",
  "unique", "uniqueName", "talent", "node", "tooltip", "wiki", "content", "section",
];

function stripNoise(html) {
  return html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ");
}

function textOf(html) {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim();
}

function tagHistogram(html) {
  const counts = new Map();
  const pattern = /<([a-zA-Z][a-zA-Z0-9-]*)\b[^>]*>/g;
  let match;
  while ((match = pattern.exec(html)) !== null) {
    const tag = match[1].toLowerCase();
    if (NOISE_TAGS.has(tag)) continue;
    counts.set(tag, (counts.get(tag) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20);
}

function classHistogram(html) {
  const counts = new Map();
  const pattern = /class="([^"]+)"/g;
  let match;
  while ((match = pattern.exec(html)) !== null) {
    for (const cls of match[1].split(/\s+/)) {
      if (!cls || cls.length > 60) continue;
      counts.set(cls, (counts.get(cls) || 0) + 1);
    }
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]);
}

/** 从 start 位置起截取一个 div 的完整内容（简单配平，不处理自闭合） */
function sliceBalancedDiv(html, startIndex) {
  const openTag = /<div\b[^>]*>/gi;
  openTag.lastIndex = startIndex;
  const first = openTag.exec(html);
  if (!first) return "";
  let depth = 1;
  let cursor = first.index + first[0].length;
  const pattern = /<div\b[^>]*>|<\/div>/gi;
  pattern.lastIndex = cursor;
  let match;
  while ((match = pattern.exec(html)) !== null) {
    if (match[0][1] === "/") {
      depth -= 1;
      if (depth === 0) return html.slice(startIndex, match.index + match[0].length);
    } else {
      depth += 1;
    }
    cursor = pattern.lastIndex;
  }
  return html.slice(startIndex, Math.min(html.length, startIndex + 4000));
}

function samplesFor(html, className, limit) {
  const samples = [];
  const needle = `class="${className}"`;
  let index = html.indexOf(needle);
  while (index !== -1 && samples.length < limit) {
    // 回退到所属标签起点
    const tagStart = html.lastIndexOf("<", index);
    const block = sliceBalancedDiv(html, tagStart);
    samples.push({ html: block.slice(0, 2000), text: textOf(block).slice(0, 400) });
    index = html.indexOf(needle, index + needle.length);
  }
  return samples;
}

async function inspectFile(file) {
  const html = stripNoise(await readFile(file, "utf8"));
  const info = await stat(file);
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? textOf(titleMatch[1]) : "(无 title)";
  const tags = tagHistogram(html);
  const classes = classHistogram(html);
  const interesting = classes.filter(([cls]) => WANT_KEYS.some((key) => cls.toLowerCase().includes(key.toLowerCase())));

  const lines = [];
  lines.push(`# 结构报告：${path.basename(file)}`);
  lines.push("");
  lines.push(`- 大小：${(info.size / 1024).toFixed(1)} KB`);
  lines.push(`- 标题：${title}`);
  lines.push(`- 去噪后长度：${html.length}`);
  lines.push("");
  lines.push("## 标签直方图（Top 20）");
  lines.push("");
  lines.push("| 标签 | 次数 |");
  lines.push("|---|---|");
  for (const [tag, count] of tags) lines.push(`| ${tag} | ${count} |`);
  lines.push("");
  lines.push("## class 频次（Top 40）");
  lines.push("");
  lines.push("| class | 次数 |");
  lines.push("|---|---|");
  for (const [cls, count] of classes.slice(0, 40)) lines.push(`| \`${cls}\` | ${count} |`);
  lines.push("");
  lines.push("## 与内容容器相关的 class（关键词过滤）");
  lines.push("");
  if (interesting.length === 0) {
    lines.push("（没有命中任何关键词，说明该页用的 class 命名不在预设列表里，需要人工看样本）");
  } else {
    lines.push("| class | 次数 |");
    lines.push("|---|---|");
    for (const [cls, count] of interesting.slice(0, 30)) lines.push(`| \`${cls}\` | ${count} |`);
  }
  lines.push("");

  const targets = interesting.slice(0, 4);
  for (const [cls] of targets) {
    lines.push(`## 样本：class="${cls}"`);
    lines.push("");
    for (const sample of samplesFor(html, cls, 2)) {
      lines.push("**纯文本**");
      lines.push("```");
      lines.push(sample.text);
      lines.push("```");
      lines.push("**原始 HTML（截断 2000 字符）**");
      lines.push("```html");
      lines.push(sample.html);
      lines.push("```");
      lines.push("");
    }
  }

  const reportPath = path.join(path.dirname(file), `_inspect-${path.basename(file, ".html")}.md`);
  await writeFile(reportPath, lines.join("\n"), "utf8");

  console.log(`\n${path.basename(file)}  ${(info.size / 1024).toFixed(1)} KB  ${title}`);
  console.log(`  tags: ${tags.slice(0, 8).map(([tag, count]) => `${tag}:${count}`).join(" ")}`);
  console.log(`  classes: ${classes.slice(0, 10).map(([cls, count]) => `${cls}:${count}`).join(" ")}`);
  console.log(`  report → ${path.relative(ROOT, reportPath)}`);
  return { file, title, size: info.size, tags, classes, reportPath };
}

async function main() {
  const args = process.argv.slice(2).filter((arg) => !arg.startsWith("--"));
  if (args.length === 0) {
    console.error("用法：node tools/inspect-html.mjs <文件或目录>");
    process.exitCode = 2;
    return;
  }
  const target = path.resolve(ROOT, args[0]);
  const info = await stat(target);
  if (info.isDirectory()) {
    const names = (await readdir(target)).filter((name) => name.endsWith(".html") && !name.startsWith("_"));
    if (names.length === 0) {
      console.log("目录里没有 .html 文件。先跑 tools/fetch-tlidb.mjs。");
      return;
    }
    for (const name of names.slice(0, 12)) {
      await inspectFile(path.join(target, name));
    }
    if (names.length > 12) console.log(`\n（共 ${names.length} 个文件，只看了前 12 个）`);
  } else {
    await inspectFile(target);
  }
}

await main();
