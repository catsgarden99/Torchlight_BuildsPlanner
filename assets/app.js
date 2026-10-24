/* 火炬之光：无限 · BD 构建规划器 —— M0 原型
 * 目标：验证「buff 来源矩阵 + 拥有判定 + 缺口建议」这套结构是否好用。
 * 约束：纯浏览器脚本，无模块、无网络请求，file:// 双击即可运行。
 */
(function () {
  "use strict";

  var META = window.TLI_META || {};
  var BUFFS = window.TLI_BUFFS || [];
  var SOURCES = window.TLI_SOURCES || [];
  var PROFILE = window.TLI_PROFILE || null;
  var INDEX = window.TLI_INDEX || null;

  var STORE_KEY = "tli.planner.m0";

  var KIND_LABEL = {
    legendary: "传奇装备",
    "gear-affix": "装备词缀",
    "hero-trait": "英雄特性",
    skill: "光环技能",
    support: "光环辅助",
    talent: "天赋",
    "core-talent": "核心天赋",
    pactspirit: "契灵",
    divinity: "神格石板",
    follower: "追随者",
  };

  var ROLE_INFO = {
    grant: { label: "提供", cls: "role-grant", hint: "能给你这个 buff" },
    consume: { label: "需求", cls: "role-consume", hint: "要求你先凑够这个 buff，否则没收益" },
    modify: { label: "影响", cls: "role-modify", hint: "改变层数上限或效果强度" },
  };

  var STATUS_INFO = {
    ok: { label: "已具备", cls: "st-ok", dot: "🟢" },
    partial: { label: "条件性/差几层", cls: "st-partial", dot: "🟡" },
    missing: { label: "不具备", cls: "st-missing", dot: "⚪" },
    unknown: { label: "上限未知", cls: "st-unknown", dot: "🔵" },
    conflict: { label: "理论有·实测无", cls: "st-conflict", dot: "🔴" },
  };

  var state = {
    selected: {},
    targets: {},
    measured: {},
    search: "",
    family: "all",
    role: "all",
    activeBuffId: null,
    storageOk: true,
    dataProblems: [],
    toast: "",
  };

  // ───────────────────────── 数据自检 ─────────────────────────
  // 数据是手写/脚本生成的，最容易出错的是"来源指向了一个不存在的 buff id"。
  // 这类错误在界面上不会崩，只会让某个 buff 静默少一条来源——所以显式报出来。
  function selfCheck() {
    var problems = [];
    var ids = {};
    BUFFS.forEach(function (buff) {
      if (ids[buff.id]) problems.push("重复的 buff id：" + buff.id);
      ids[buff.id] = true;
    });
    SOURCES.forEach(function (source) {
      (source.buffIds || []).forEach(function (id) {
        if (!ids[id]) problems.push("来源 " + source.id + " 指向不存在的 buff：" + id);
      });
      if (!source.buffIds || source.buffIds.length === 0) problems.push("来源 " + source.id + " 没有挂任何 buff");
    });
    BUFFS.forEach(function (buff) {
      (buff.aggregate || []).forEach(function (id) {
        if (!ids[id]) problems.push("聚合 " + buff.id + " 指向不存在的 buff：" + id);
      });
    });
    return problems;
  }

  // ───────────────────────── 存储（localStorage 失败时自动降级）─────────────────────────
  function loadState() {
    try {
      var raw = window.localStorage.getItem(STORE_KEY);
      if (!raw) return;
      var parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") {
        state.selected = parsed.selected || {};
        state.targets = parsed.targets || {};
        state.measured = parsed.measured || {};
        state.activeBuffId = parsed.activeBuffId || null;
      }
    } catch (err) {
      state.storageOk = false;
    }
  }

  function saveState() {
    if (!state.storageOk) return;
    try {
      window.localStorage.setItem(
        STORE_KEY,
        JSON.stringify({
          selected: state.selected,
          targets: state.targets,
          measured: state.measured,
          activeBuffId: state.activeBuffId,
        })
      );
    } catch (err) {
      state.storageOk = false;
      setToast("浏览器禁止了本地存储，已切为「导出/导入存档」模式");
    }
  }

  // ───────────────────────── 工具 ─────────────────────────
  function esc(text) {
    return String(text == null ? "" : text)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function fmtNum(value) {
    if (value == null) return "—";
    var n = Math.round(value * 10) / 10;
    return String(n);
  }

  function buffById(id) {
    for (var i = 0; i < BUFFS.length; i++) if (BUFFS[i].id === id) return BUFFS[i];
    return null;
  }

  function sourcesFor(buffId) {
    return SOURCES.filter(function (source) {
      return source.buffIds.indexOf(buffId) !== -1;
    });
  }

  function familyLabel(key) {
    var families = META.families || {};
    return families[key] ? families[key].label : key;
  }

  function setToast(message) {
    state.toast = message;
    render();
    window.setTimeout(function () {
      state.toast = "";
      render();
    }, 3200);
  }

  // ───────────────────────── 代价向量 ─────────────────────────
  function costParts(cost) {
    cost = cost || {};
    var parts = [];
    if (cost.currency) parts.push("🔥 " + cost.currency);
    if (cost.gearSlots) parts.push("词条位×" + cost.gearSlots);
    if (cost.skillSlots) parts.push("技能位×" + cost.skillSlots);
    if (cost.supportSlots) parts.push("辅助位×" + cost.supportSlots);
    if (cost.talentPoints) parts.push("天赋点×" + cost.talentPoints);
    if (cost.heroLock) parts.push("锁英雄：" + cost.heroLock);
    if (cost.load) parts.push("负担:" + cost.load);
    return parts;
  }

  function costScore(cost) {
    cost = cost || {};
    var w = META.costWeights || {};
    var score = 0;
    if (cost.currency) score += cost.currency / (w.currencyPerPoint || 20);
    score += (cost.gearSlots || 0) * (w.gearSlot == null ? 2 : w.gearSlot);
    score += (cost.skillSlots || 0) * (w.skillSlot == null ? 2 : w.skillSlot);
    score += (cost.supportSlots || 0) * (w.supportSlot == null ? 1 : w.supportSlot);
    score += (cost.talentPoints || 0) * (w.talentPoint == null ? 0.3 : w.talentPoint);
    if (cost.heroLock) score += w.heroLock == null ? 6 : w.heroLock;
    if (cost.load && w.load && w.load[cost.load] != null) score += w.load[cost.load];
    return Math.round(score * 10) / 10;
  }

  // ───────────────────────── 判定引擎 ─────────────────────────
  function computeBuff(buffId, seen) {
    var buff = buffById(buffId);
    if (!buff) return null;
    seen = seen || [];
    if (seen.indexOf(buffId) !== -1) return null; // 防止 aggregate 成环

    var rows = sourcesFor(buffId);
    var chosen = rows.filter(function (row) {
      return !!state.selected[row.id];
    });

    var capDelta = 0;
    var capKnown = buff.baseCap != null;
    chosen.forEach(function (row) {
      if (row.role === "modify" && row.effect && typeof row.effect.cap === "number") {
        capDelta += row.effect.cap;
        capKnown = true;
      }
    });
    var cap = capKnown ? (buff.baseCap || 0) + capDelta : null;

    var steady = chosen.some(function (row) {
      return row.role === "grant" && row.effect && row.effect.mode === "steady";
    });
    var burst = 0;
    chosen.forEach(function (row) {
      if (row.role === "grant" && row.effect && typeof row.effect.stacks === "number") {
        burst += row.effect.stacks;
      }
    });

    var granted = steady ? cap : burst; // steady 且 cap 未知 → null（未知）

    // 聚合型 buff（如「任意祝福」= 三种祝福之和）：用自己的来源算不出来，改为累加子 buff
    if (buff.aggregate && buff.aggregate.length) {
      var sum = 0;
      var known = true;
      var nextSeen = seen.concat([buffId]);
      buff.aggregate.forEach(function (subId) {
        var sub = computeBuff(subId, nextSeen);
        if (!sub || sub.actual == null) known = false;
        else sum += sub.actual;
      });
      granted = known ? sum : null;
    }

    var actual = granted == null ? null : cap != null ? Math.min(granted, cap) : granted;

    // 「存在即生效」型（如光环效果加成）：只看有没有选中来源，不算层数
    if (buff.presence) {
      granted = chosen.length > 0 ? 1 : 0;
      actual = granted;
    }

    var target = state.targets[buffId] != null ? state.targets[buffId] : buff.targetDefault;
    var measured = state.measured[buffId] != null ? state.measured[buffId] : null;
    var best = actual == null ? measured : actual;

    var status;
    if (measured != null && best != null && best > 0 && measured < Math.min(best, target)) {
      status = "conflict";
    } else if (best != null && best >= target) {
      status = "ok";
    } else if (best == null && (steady || chosen.length > 0)) {
      status = "unknown";
    } else if (best != null && best > 0) {
      status = "partial";
    } else if (granted == null && steady) {
      status = "unknown";
    } else {
      status = "missing";
    }

    var gap = best == null ? null : Math.max(0, target - best);

    return {
      buff: buff,
      rows: rows,
      chosen: chosen,
      cap: cap,
      granted: granted,
      actual: actual,
      target: target,
      measured: measured,
      best: best,
      status: status,
      gap: gap,
      steady: steady,
    };
  }

  function suggestions(buffId) {
    var info = computeBuff(buffId);
    if (!info) return [];
    var pool = info.rows.slice();
    // 聚合型 buff 自身没有「提供」型来源，补法要从子 buff 里找
    if (info.buff.aggregate && info.buff.aggregate.length) {
      info.buff.aggregate.forEach(function (subId) {
        sourcesFor(subId).forEach(function (row) {
          var exists = pool.some(function (item) {
            return item.id === row.id;
          });
          if (!exists) pool.push(row);
        });
      });
    }
    return pool
      .filter(function (row) {
        return row.role === "grant" && !state.selected[row.id];
      })
      .map(function (row) {
        return { row: row, score: costScore(row.cost) };
      })
      .sort(function (a, b) {
        return a.score - b.score;
      });
  }

  // ───────────────────────── 渲染 ─────────────────────────
  /** 这条来源是否锁在别的英雄上（按 data/profile.js 的画像判断） */
  function isOffHero(row) {
    if (!PROFILE || !PROFILE.hero || !row.cost) return false;
    var lock = row.cost.heroLock;
    if (!lock) return false;
    return lock !== PROFILE.hero.name && lock !== PROFILE.hero.trait;
  }

  function render() {
    var app = document.getElementById("app");
    if (!app) return;
    if (!state.activeBuffId || !buffById(state.activeBuffId)) {
      state.activeBuffId = BUFFS.length ? BUFFS[0].id : null;
    }
    app.innerHTML =
      renderTopbar() +
      '<div class="layout">' +
      renderSidebar() +
      renderDetail() +
      renderSummary() +
      "</div>" +
      (state.toast ? '<div class="toast">' + esc(state.toast) + "</div>" : "");
  }

  function renderTopbar() {
    var chips =
      '<span class="chip chip-season">' +
      esc(META.season || "?") +
      " " +
      esc(META.seasonName || "") +
      "</span>" +
      '<span class="chip chip-data">' +
      esc(META.dataStatus || "数据") +
      "</span>" +
      '<span class="chip chip-count">' +
      BUFFS.length +
      " buff · " +
      SOURCES.length +
      " 来源</span>";

    if (PROFILE && PROFILE.hero) {
      var hero = PROFILE.hero;
      chips +=
        '<span class="chip chip-hero" title="来自 data/profile.js">' +
        esc(hero.title + "·" + hero.trait) +
        (PROFILE.mainSkill && PROFILE.mainSkill.name ? " ｜ " + esc(PROFILE.mainSkill.name) : "") +
        "</span>";
    }

    if (!state.storageOk) chips += '<span class="chip chip-warn">本地存储不可用</span>';
    if (state.dataProblems.length > 0) {
      chips +=
        '<span class="chip chip-warn" title="' +
        esc(state.dataProblems.join("\n")) +
        '">数据自检 ' +
        state.dataProblems.length +
        " 项</span>";
    }

    return (
      '<header class="topbar">' +
      '<div class="brand"><b>火炬之光：无限</b><span>BD 构建规划器</span></div>' +
      "<div class=\"chips\">" +
      chips +
      "</div>" +
      '<div class="topbar-actions">' +
      '<input id="search" class="search" type="search" placeholder="搜索 buff / 来源 / 词条原文…" value="' +
      esc(state.search) +
      '" />' +
      '<button class="btn" data-action="demo">示例配置</button>' +
      '<button class="btn" data-action="export">导出存档</button>' +
      '<button class="btn" data-action="import">导入存档</button>' +
      '<input id="importFile" type="file" accept="application/json" hidden />' +
      "</div>" +
      "</header>"
    );
  }

  function renderSidebar() {
    var families = META.families || {};
    var keys = Object.keys(families);
    var html = '<aside class="sidebar"><div class="side-title">buff 家族</div>';

    html +=
      '<button class="family' +
      (state.family === "all" ? " active" : "") +
      '" data-family="all">全部<span class="num">' +
      BUFFS.length +
      "</span></button>";

    keys.forEach(function (key) {
      var items = BUFFS.filter(function (buff) {
        return buff.family === key;
      });
      html +=
        '<button class="family' +
        (state.family === key ? " active" : "") +
        '" data-family="' +
        key +
        '">' +
        esc(families[key].label) +
        '<span class="num' +
        (items.length ? "" : " num-empty") +
        '">' +
        (items.length ? items.length : "待补") +
        "</span></button>";
    });

    var query = state.search.trim().toLowerCase();
    var visible = BUFFS.filter(function (buff) {
      if (state.family !== "all" && buff.family !== state.family) return false;
      if (!query) return true;
      var haystack = [buff.name, buff.id, (buff.aliases || []).join(" "), buff.summary, buff.mechanics].join(" ");
      var rows = sourcesFor(buff.id).map(function (row) {
        return row.name + " " + row.text + " " + (row.constraints || []).join(" ");
      });
      return (haystack + " " + rows.join(" ")).toLowerCase().indexOf(query) !== -1;
    });

    html += '<div class="side-title">buff 列表 <span class="num">' + visible.length + "</span></div>";
    html += '<div class="buff-list">';
    visible.forEach(function (buff) {
      var info = computeBuff(buff.id);
      var status = STATUS_INFO[info.status];
      var count = sourcesFor(buff.id).length;
      html +=
        '<button class="buff' +
        (state.activeBuffId === buff.id ? " active" : "") +
        '" data-buff="' +
        buff.id +
        '">' +
        '<span class="dot ' +
        status.cls +
        '"></span>' +
        '<span class="buff-name">' +
        esc(buff.name) +
        (buff.incomplete ? '<span class="tiny">待补</span>' : "") +
        "</span>" +
        '<span class="buff-meta">' +
        (info.best == null ? "?" : fmtNum(info.best)) +
        "/" +
        fmtNum(info.target) +
        " · " +
        count +
        "源</span>" +
        "</button>";
    });
    if (!visible.length) html += '<div class="empty">没有匹配的 buff</div>';
    html += "</div></aside>";
    return html;
  }

  function renderDetail() {
    var buff = buffById(state.activeBuffId);
    if (!buff) return '<main class="detail"><div class="empty">无数据</div></main>';

    var info = computeBuff(buff.id);
    var status = STATUS_INFO[info.status];
    var rows = info.rows;

    var filtered = rows.filter(function (row) {
      if (state.role !== "all" && row.role !== state.role) return false;
      return true;
    });

    var roleCounts = { grant: 0, consume: 0, modify: 0 };
    rows.forEach(function (row) {
      roleCounts[row.role] = (roleCounts[row.role] || 0) + 1;
    });

    var html = '<main class="detail">';

    html +=
      '<div class="detail-head">' +
      '<div class="detail-title"><h1>' +
      esc(buff.name) +
      "</h1>" +
      '<span class="tag">' +
      esc(familyLabel(buff.family)) +
      "</span>" +
      '<span class="status-pill ' +
      status.cls +
      '">' +
      status.dot +
      " " +
      status.label +
      "</span>" +
      (buff.incomplete ? '<span class="tag tag-warn">内容待补</span>' : "") +
      "</div>" +
      '<p class="summary">' +
      esc(buff.summary) +
      "</p>" +
      "</div>";

    // 实测/目标控制条
    html +=
      '<div class="controls">' +
      '<label class="field"><span>目标' +
      esc(buff.unit || "层") +
      "</span>" +
      '<input type="number" min="0" step="1" data-field="target" value="' +
      info.target +
      '" /></label>' +
      '<label class="field"><span>我已实测</span>' +
      '<input type="number" min="0" step="1" placeholder="未填" data-field="measured" value="' +
      (info.measured == null ? "" : info.measured) +
      '" /></label>' +
      '<div class="calc">' +
      "理论：" +
      (info.granted == null ? "上限未知" : fmtNum(info.granted)) +
      " → 实际：" +
      (info.actual == null ? "未知" : fmtNum(info.actual)) +
      (info.steady ? "（稳态：按可持续叠满估，非爆发）" : "") +
      (info.cap == null ? "" : "（上限 " + fmtNum(info.cap) + "）") +
      (info.gap == null ? "" : " ｜ 缺口 " + fmtNum(info.gap)) +
      "</div>" +
      "</div>";

    // 机制
    if (buff.mechanics) {
      html +=
        '<section class="block"><h2>机制 / 判定要点</h2><pre class="mechanics">' +
        esc(buff.mechanics) +
        "</pre></section>";
    }

    // 筛选
    html +=
      '<section class="block"><div class="block-head"><h2>来源矩阵</h2><div class="filters">' +
      filterButton("all", "全部", rows.length) +
      filterButton("grant", "提供", roleCounts.grant) +
      filterButton("consume", "需求", roleCounts.consume) +
      filterButton("modify", "影响", roleCounts.modify) +
      "</div></div>";

    html += '<div class="rows">';
    if (!filtered.length) {
      html += '<div class="empty">该筛选下没有来源。矩阵为空通常意味着：这个 buff 还没有被收录，而不是它拿不到。</div>';
    }
    filtered.forEach(function (row) {
      html += renderSourceRow(row);
    });
    html += "</div></section>";

    html += renderIndexSection(buff);

    // 引用
    var refs = buff.refs || [];
    if (refs.length) {
      html += '<section class="block"><h2>出处</h2><div class="refs">';
      refs.forEach(function (ref) {
        html += '<a href="' + esc(ref.url) + '" target="_blank" rel="noreferrer">' + esc(ref.label) + "</a>";
      });
      html += "</div></section>";
    }

    html += "</main>";
    return html;
  }

  function filterButton(key, label, count) {
    return (
      '<button class="filter' +
      (state.role === key ? " active" : "") +
      '" data-role="' +
      key +
      '">' +
      label +
      '<span class="num">' +
      count +
      "</span></button>"
    );
  }

  /** 全库命中：从抓取到的所有词条里，凡文本含该 buff 关键字的，都列为“来源候选” */
  function renderIndexSection(buff) {
    if (!INDEX || !INDEX.items) return "";
    var record = null;
    for (var i = 0; i < INDEX.items.length; i++) {
      if (INDEX.items[i].buffId === buff.id) {
        record = INDEX.items[i];
        break;
      }
    }
    if (!record || record.count === 0) return "";

    var pages = Object.keys(record.byPage)
      .map(function (key) {
        return { page: key, count: record.byPage[key] };
      })
      .sort(function (a, b) {
        return b.count - a.count;
      });

    var html = '<section class="block"><div class="block-head"><h2>全库命中（自动索引）</h2>' +
      '<span class="hint">' + record.count + " 条词条 · " + pages.length + " 个页面 · 共扫描 " + INDEX.scannedMods + " 条</span></div>";
    html += '<div class="pagebars">';
    pages.forEach(function (entry) {
      html += '<span class="pagebar"><b>' + esc(entry.page) + "</b>" + entry.count + "</span>";
    });
    html += "</div>";

    var samples = record.samples || [];
    html += '<div class="hits">';
    samples.slice(0, 8).forEach(function (hit) {
      html += renderHit(hit);
    });
    html += "</div>";
    if (samples.length > 8) {
      html += '<details class="more"><summary>再看 ' + (samples.length - 8) + " 条</summary><div class=\"hits\">";
      samples.slice(8).forEach(function (hit) {
        html += renderHit(hit);
      });
      html += "</div></details>";
    }
    html += '<div class="note">索引只按关键字匹配，未判断语义（例：提供 vs 需求）。上面的“来源矩阵”是人工核实过的版本；这里是用来看“全库到底还有多少条相关词条”。</div>';
    html += "</section>";
    return html;
  }

  function renderHit(hit) {
    var where = [];
    if (hit.category) where.push(hit.category);
    where.push(hit.page);
    if (hit.tier !== null && hit.tier !== undefined) where.push("T" + hit.tier);
    var html = '<article class="hit">';
    html += '<div class="hit-head">';
    html += '<span class="hit-name">' + esc(hit.item || "（未标注条目）") + "</span>";
    html += '<span class="hit-where">' + esc(where.join(" · ")) + "</span>";
    if (hit.corroded) html += '<span class="tiny">侵蚀</span>';
    html += "</div>";
    html += '<div class="hit-text">' + esc(hit.text) + "</div>";
    html += "</article>";
    return html;
  }

  function renderSourceRow(row) {
    var role = ROLE_INFO[row.role] || { label: row.role, cls: "", hint: "" };
    var checked = !!state.selected[row.id];
    var score = costScore(row.cost);
    var chips = costParts(row.cost)
      .map(function (part) {
        return '<span class="cost">' + esc(part) + "</span>";
      })
      .join("");

    var off = isOffHero(row);
    var html = '<article class="src' + (checked ? " checked" : "") + (off ? " off-hero" : "") + '">';
    html += '<div class="src-main">';
    html +=
      '<label class="pick"><input type="checkbox" data-src="' +
      row.id +
      '"' +
      (checked ? " checked" : "") +
      ' /><span>已在配置</span></label>';
    html += '<div class="src-head">';
    html += '<span class="role ' + role.cls + '" title="' + esc(role.hint) + '">' + role.label + "</span>";
    html += '<span class="src-name">' + esc(row.name) + "</span>";
    html += '<span class="kind">' + esc(KIND_LABEL[row.kind] || row.kind) + "</span>";
    if (row.incomplete) html += '<span class="tiny">待补</span>';
    if (row.verified) html += '<span class="tiny tiny-ok">原文</span>';
    if (off) html += '<span class="tiny tiny-off">需换英雄：' + esc(row.cost.heroLock) + "</span>";
    html += "</div>";
    html += '<div class="src-value">' + esc(row.value || "") + "</div>";
    html += '<div class="src-cost">' + chips + '<span class="score" title="代价分（越小越便宜）">代价 ' + score + "</span></div>";
    if (row.constraints && row.constraints.length) {
      html +=
        '<div class="src-req">前置：' +
        row.constraints
          .map(function (item) {
            return '<span class="req">' + esc(item) + "</span>";
          })
          .join("") +
        "</div>";
    }
    html +=
      '<details class="src-text"><summary>原文</summary><pre>' +
      esc(row.text || "") +
      "</pre>" +
      (row.ref ? '<a class="ref" href="' + esc(row.ref) + '" target="_blank" rel="noreferrer">在 tlidb 打开 ↗</a>' : "") +
      "</details>";
    html += "</div></article>";
    return html;
  }

  function renderSummary() {
    var stats = { ok: 0, partial: 0, missing: 0, unknown: 0, conflict: 0 };
    var gaps = [];
    BUFFS.forEach(function (buff) {
      var info = computeBuff(buff.id);
      stats[info.status] = (stats[info.status] || 0) + 1;
      if (info.status !== "ok") {
        gaps.push(info);
      }
    });

    var html = '<aside class="summary">';
    html += '<div class="side-title">覆盖总览</div>';
    html += '<div class="stat-grid">';
    html += statBox("🟢 已具备", stats.ok, "st-ok");
    html += statBox("🟡 差几层", stats.partial, "st-partial");
    html += statBox("🔵 上限未知", stats.unknown, "st-unknown");
    html += statBox("🔴 理论有实测无", stats.conflict, "st-conflict");
    html += statBox("⚪ 不具备", stats.missing, "st-missing");
    html += "</div>";

    html += '<div class="side-title">缺口与补法</div>';
    if (!gaps.length) {
      html += '<div class="empty">当前 buff 全部达标。</div>';
    }
    gaps
      .sort(function (a, b) {
        return (b.gap == null ? 99 : b.gap) - (a.gap == null ? 99 : a.gap);
      })
      .forEach(function (info) {
        var list = suggestions(info.buff.id).slice(0, 3);
        html += '<div class="gap">';
        html +=
          '<div class="gap-head"><b>' +
          esc(info.buff.name) +
          "</b><span>" +
          (info.best == null ? "未知" : fmtNum(info.best)) +
          "/" +
          fmtNum(info.target) +
          "</span></div>";
        if (info.status === "conflict") {
          html += '<div class="gap-warn">配置算得出 ' + fmtNum(info.actual) + "，但你实测 " + fmtNum(info.measured) + "：去查触发顺序 / 同名覆盖 / 上限被压。</div>";
        }
        if (!list.length) {
          html += '<div class="gap-none">暂无「提供」型来源可补（或已被你全选）。</div>';
        } else {
          html += '<ul class="plans">';
          list.forEach(function (item) {
            html +=
              '<li><button class="plan" data-plan="' +
              item.row.id +
              '">' +
              esc(item.row.name) +
              '<span class="plan-score">代价 ' +
              item.score +
              "</span></button></li>";
          });
          html += "</ul>";
        }
        html += "</div>";
      });

    html +=
      '<div class="note">代价分 = 火/20 + 词条位×2 + 技能位×2 + 辅助位×1 + 天赋点×0.3 + 锁英雄×6 + 负担。' +
      "权重在 data/meta.js 里，可自己改。</div>";
    html += "</aside>";
    return html;
  }

  function statBox(label, value, cls) {
    return '<div class="stat ' + cls + '"><span class="stat-num">' + value + '</span><span class="stat-label">' + label + "</span></div>";
  }

  // ───────────────────────── 事件 ─────────────────────────
  function bindEvents() {
    document.addEventListener("input", function (event) {
      var el = event.target;
      if (el.id === "search") {
        state.search = el.value;
        // 只重画侧栏，避免搜索框失焦
        var sidebar = document.querySelector(".sidebar");
        if (sidebar) {
          var fresh = document.createElement("div");
          fresh.innerHTML = renderSidebar();
          if (fresh.firstChild) sidebar.replaceWith(fresh.firstChild);
        }
        return;
      }
      // 数字输入不在这里处理：input 事件里重渲染会打断输入（焦点丢失），见 change 分支。
    });

    document.addEventListener("change", function (event) {
      var el = event.target;
      if (el.dataset && el.dataset.field === "target") {
        var value = parseInt(el.value, 10);
        if (!isNaN(value) && value >= 0) {
          state.targets[state.activeBuffId] = value;
          saveState();
        }
        render();
        return;
      }
      if (el.dataset && el.dataset.field === "measured") {
        var measured = parseInt(el.value, 10);
        if (el.value === "" || isNaN(measured)) {
          delete state.measured[state.activeBuffId];
        } else if (measured >= 0) {
          state.measured[state.activeBuffId] = measured;
        }
        saveState();
        render();
        return;
      }
      if (el.dataset && el.dataset.src) {
        if (el.checked) state.selected[el.dataset.src] = true;
        else delete state.selected[el.dataset.src];
        saveState();
        render();
        return;
      }
      if (el.id === "importFile" && el.files && el.files[0]) {
        var reader = new FileReader();
        reader.onload = function () {
          try {
            var data = JSON.parse(String(reader.result));
            state.selected = data.selected || {};
            state.targets = data.targets || {};
            state.measured = data.measured || {};
            saveState();
            setToast("存档已导入");
          } catch (err) {
            setToast("导入失败：不是有效的存档 JSON");
          }
        };
        reader.readAsText(el.files[0]);
      }
    });

    document.addEventListener("click", function (event) {
      var el = event.target;
      var familyBtn = el.closest("[data-family]");
      if (familyBtn) {
        state.family = familyBtn.getAttribute("data-family");
        render();
        return;
      }
      var buffBtn = el.closest("[data-buff]");
      if (buffBtn) {
        state.activeBuffId = buffBtn.getAttribute("data-buff");
        saveState();
        render();
        return;
      }
      var roleBtn = el.closest("[data-role]");
      if (roleBtn) {
        state.role = roleBtn.getAttribute("data-role");
        render();
        return;
      }
      var planBtn = el.closest("[data-plan]");
      if (planBtn) {
        var id = planBtn.getAttribute("data-plan");
        state.selected[id] = true;
        saveState();
        render();
        setToast("已加入配置：" + id);
        return;
      }
      var actionBtn = el.closest("[data-action]");
      if (actionBtn) {
        var action = actionBtn.getAttribute("data-action");
        if (action === "export") exportSave();
        if (action === "import") document.getElementById("importFile").click();
        if (action === "demo") loadDemo();
      }
    });
  }

  function loadDemo() {
    // 「希雅·渎神」示例：自动供祝福 + 上限转换 + 传奇门槛词条，用来演示整条判定链
    state.selected = {};
    [
      "src.trait.blasphemer.grant",
      "src.trait.blasphemy_ultimate",
      "src.trait.tenacity_dominion.consume",
      "src.legendary.will",
      "src.legendary.gauze_of_phantom_sin",
      "src.skill.aura.fearless",
      "src.support.concentrated",
    ].forEach(function (id) {
      state.selected[id] = true;
    });
    state.targets = { "blessing.tenacity": 10, "blessing.any": 6, blasphemy: 10, "aura.fearless": 1 };
    state.measured = { "blessing.tenacity": 4 };
    state.activeBuffId = "blessing.tenacity";
    saveState();
    render();
    setToast("已载入示例：注意「坚韧祝福」理论 vs 实测 4 层的差异");
  }

  function exportSave() {
    var payload = {
      app: "tli-builds-planner",
      version: 1,
      season: META.season,
      exportedAt: new Date().toISOString(),
      selected: state.selected,
      targets: state.targets,
      measured: state.measured,
    };
    var blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    var url = URL.createObjectURL(blob);
    var link = document.createElement("a");
    link.href = url;
    link.download = "tli-planner-save-" + (META.season || "dev") + ".json";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.setTimeout(function () {
      URL.revokeObjectURL(url);
    }, 1000);
    setToast("已导出存档 JSON");
  }

  // ───────────────────────── 启动 ─────────────────────────
  state.dataProblems = selfCheck();
  loadState();
  bindEvents();
  render();
})();
