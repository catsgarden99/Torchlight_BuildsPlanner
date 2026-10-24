#!/usr/bin/env node
/**
 * 阶段 A：把 tlidb 页面原样抓下来（只存不改）。
 *
 * 为什么先抓不解析：tlidb 的 DOM 结构没有公开文档，盲写选择器一定返工。
 * 先把 HTML 落到 data/raw/，再用 tools/inspect-html.mjs 看真实结构，最后写解析器。
 *
 * 用法：
 *   node tools/fetch-tlidb.mjs --list                     # 看清单
 *   node tools/fetch-tlidb.mjs --only=system,gear-slots   # 按 group 抓
 *   node tools/fetch-tlidb.mjs --all                      # 全抓（约 60 页）
 *   node tools/fetch-tlidb.mjs --only=Blessing --force    # 强制重抓
 *   node tools/fetch-tlidb.mjs --only=skills --expand     # 顺带展开技能详情页
 *   node tools/fetch-tlidb.mjs --all --dry-run            # 只打印，不发请求
 *
 * 特性：断点续抓（已存在跳过）、失败重试 3 次（指数退避）、manifest 记 sha256/字节数/时间。
 * 要求：Node 18+（自带 fetch）。仅供个人研究使用，请勿高频抓取。
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const RAW_DIR = path.join(ROOT, "data", "raw");
const MANIFEST = path.join(RAW_DIR, "manifest.json");

const USER_AGENT =
  "tli-builds-planner/0.1 (personal build analysis; contact: local user)";

/** 站点导航里的固定 slug，--expand 时不应被当成详情页 */
const NAV_SLUGS = new Set([
  "Hero", "Talent", "Ethereal_Prism", "Pactspirit", "Destiny", "Inventory",
  "Legendary_Gear", "Follower", "Active_Skill", "Support_Skill", "Passive_Skill",
  "Activation_Medium_Skill", "Magnificent_Support_Skill", "Noble_Support_Skill",
  "Modularization_Skill", "Tartarus_Skill", "Origin_Tartarus_Skill", "Craft",
  "Corrosion", "Blending_Rituals", "TOWER_Sequence", "Graft", "Memory_Revival",
  "Nether_Kings_Divinity", "Netherrealm", "Confusion_Card_Library", "Void_Chart",
  "Compass", "Probe", "Season_Compass", "Path_of_the_Brave", "Tip", "Help",
  "Path_of_Progression", "Codex", "Journey", "Skill", "Gear", "Hero_Memories",
  "Loot", "Divinity_Slate", "Challenge", "Account", "Pactspirit_Shop", "Pack",
  "Illusion_Essence_Shop", "Outfit_Shop", "Ultimate_Shop", "Outfit_Pack",
  "Outfit", "Commodity", "Boon", "en", "tw", "cn", "ko", "ja", "ru",
]);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function parseArgs(argv) {
  const options = {
    only: [],
    all: false,
    force: false,
    expand: false,
    dryRun: false,
    list: false,
    delay: 450,
    retries: 3,
    timeoutMs: 20000,
  };
  for (const arg of argv) {
    if (arg === "--all") options.all = true;
    else if (arg === "--force") options.force = true;
    else if (arg === "--expand") options.expand = true;
    else if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--list") options.list = true;
    else if (arg.startsWith("--only=")) options.only = arg.slice("--only=".length).split(",").map((s) => s.trim()).filter(Boolean);
    else if (arg.startsWith("--slug=")) options.slugs = arg.slice("--slug=".length).split(",").map((s) => s.trim()).filter(Boolean);
    else if (arg.startsWith("--delay=")) options.delay = Number(arg.slice("--delay=".length)) || 450;
    else if (arg.startsWith("--retries=")) options.retries = Number(arg.slice("--retries=".length)) || 3;
    else if (arg === "--help" || arg === "-h") options.help = true;
    else console.warn(`[warn] 忽略无法识别的参数：${arg}`);
  }
  return options;
}

async function loadPages() {
  const raw = await readFile(path.join(HERE, "pages.json"), "utf8");
  return JSON.parse(raw);
}

async function loadManifest() {
  try {
    return JSON.parse(await readFile(MANIFEST, "utf8"));
  } catch {
    return { season: null, entries: {} };
  }
}

async function fileExists(target) {
  try {
    const info = await stat(target);
    return info.isFile() && info.size > 0;
  } catch {
    return false;
  }
}

async function fetchOnce(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      headers: { "user-agent": USER_AGENT, "accept-language": "zh-CN,zh;q=0.9" },
      signal: controller.signal,
      redirect: "follow",
    });
    return response;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchWithRetry(url, options) {
  let lastError;
  for (let attempt = 1; attempt <= options.retries; attempt += 1) {
    try {
      const response = await fetchOnce(url, options.timeoutMs);
      if (response.status === 429 || response.status >= 500) {
        throw new Error(`HTTP ${response.status}`);
      }
      return response;
    } catch (error) {
      lastError = error;
      const wait = 800 * 2 ** (attempt - 1);
      console.warn(`  ! 第 ${attempt} 次失败（${error.message}），${wait}ms 后重试`);
      await sleep(wait);
    }
  }
  throw lastError;
}

function sha256(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/** 从列表页 HTML 里抽取详情页 slug（只看 /cn/ 下的链接） */
function extractSlugs(html, locale) {
  const slugs = new Set();
  const pattern = new RegExp(`href="(?:/${locale}/)?([A-Za-z0-9_%.-]+)"`, "g");
  let match;
  while ((match = pattern.exec(html)) !== null) {
    const slug = decodeURIComponent(match[1]);
    if (slug.includes(".")) continue; // 跳过图片/附件
    if (NAV_SLUGS.has(slug)) continue;
    slugs.add(slug);
  }
  return [...slugs];
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log("见本文件顶部注释里的用法。");
    return;
  }

  const pages = await loadPages();
  const base = pages.base.replace(/\/$/, "");
  const locale = pages.locale || "cn";

  if (options.list) {
    const groups = new Map();
    for (const page of pages.pages) {
      if (!groups.has(page.group)) groups.set(page.group, []);
      groups.get(page.group).push(page);
    }
    for (const [group, items] of groups) {
      console.log(`\n[${group}] ${items.length} 页`);
      for (const item of items) console.log(`  ${item.slug.padEnd(34)} ${item.note || ""}`);
    }
    return;
  }

  let queue = pages.pages;
  if (options.slugs && options.slugs.length > 0) {
    // 单页/指定 slug：用于按需抓某个技能或装备详情页
    queue = options.slugs.map((slug) => ({ slug, group: "ad-hoc", note: "指定抓取" }));
  } else if (options.only.length > 0) {
    const wanted = new Set(options.only);
    queue = pages.pages.filter((page) => wanted.has(page.group) || wanted.has(page.slug));
  } else if (!options.all) {
    console.error("请指定 --all 或 --only=<group|slug>（先跑 --list 看清单）");
    process.exitCode = 2;
    return;
  }

  if (queue.length === 0) {
    console.error("没有匹配到任何页面，检查 --only 的取值");
    process.exitCode = 2;
    return;
  }

  console.log(`目标：${queue.length} 页，来源 ${base}/${locale}/ ，输出 ${path.relative(ROOT, RAW_DIR)}`);
  if (!options.dryRun) await mkdir(RAW_DIR, { recursive: true });

  const manifest = await loadManifest();
  manifest.season = pages.season;
  manifest.seasonName = pages.seasonName;
  manifest.locale = locale;
  manifest.entries = manifest.entries || {};

  const stats = { fetched: 0, skipped: 0, failed: 0, expanded: 0 };
  const expandedQueue = [];

  for (const page of queue) {
    const url = `${base}/${locale}/${page.slug}`;
    const file = path.join(RAW_DIR, `${page.slug}.html`);

    if (!options.force && (await fileExists(file))) {
      console.log(`- 跳过（已存在） ${page.slug}`);
      stats.skipped += 1;
      continue;
    }
    if (options.dryRun) {
      console.log(`- 将抓取 ${url}`);
      continue;
    }

    process.stdout.write(`+ ${page.slug} … `);
    try {
      const response = await fetchWithRetry(url, options);
      const html = await response.text();
      if (response.status !== 200) {
        console.log(`HTTP ${response.status}（已记录，不中断）`);
        manifest.entries[page.slug] = {
          url,
          status: response.status,
          fetchedAt: new Date().toISOString(),
          group: page.group,
        };
        stats.failed += 1;
      } else {
        await writeFile(file, html, "utf8");
        manifest.entries[page.slug] = {
          url,
          status: 200,
          fetchedAt: new Date().toISOString(),
          group: page.group,
          bytes: Buffer.byteLength(html, "utf8"),
          sha256: sha256(html),
        };
        stats.fetched += 1;
        console.log(`${(Buffer.byteLength(html, "utf8") / 1024).toFixed(1)} KB`);

        if (options.expand && page.group === "skills") {
          const slugs = extractSlugs(html, locale);
          console.log(`  ↳ 展开到 ${slugs.length} 个候选详情页`);
          for (const slug of slugs) expandedQueue.push({ slug, group: "skill-detail", note: `来自 ${page.slug}` });
          stats.expanded += slugs.length;
        }
      }
    } catch (error) {
      console.warn(`失败：${error.message}`);
      stats.failed += 1;
    }

    await sleep(options.delay);
  }

  if (!options.dryRun && expandedQueue.length > 0) {
    const known = new Set(pages.pages.map((page) => page.slug));
    for (const item of expandedQueue) {
      if (known.has(item.slug)) continue;
      known.add(item.slug);
      const url = `${base}/${locale}/${item.slug}`;
      const file = path.join(RAW_DIR, `${item.slug}.html`);
      if (!options.force && (await fileExists(file))) {
        stats.skipped += 1;
        continue;
      }
      try {
        const response = await fetchWithRetry(url, options);
        if (response.status !== 200) {
          stats.failed += 1;
          continue;
        }
        const html = await response.text();
        await writeFile(file, html, "utf8");
        manifest.entries[item.slug] = {
          url,
          status: 200,
          fetchedAt: new Date().toISOString(),
          group: "skill-detail",
          bytes: Buffer.byteLength(html, "utf8"),
          sha256: sha256(html),
          parent: item.note,
        };
        stats.fetched += 1;
      } catch {
        stats.failed += 1;
      }
      await sleep(options.delay);
    }
  }

  if (!options.dryRun) {
    await writeFile(MANIFEST, JSON.stringify(manifest, null, 2), "utf8");
    console.log(
      `\n完成：抓 ${stats.fetched} / 跳 ${stats.skipped} / 失败 ${stats.failed}` +
        (stats.expanded ? ` / 展开候选 ${stats.expanded}` : "")
    );
    console.log(`manifest → ${path.relative(ROOT, MANIFEST)}`);
    console.log("下一步：node tools/inspect-html.mjs data/raw/Blessing.html");
  }
}

await main();
