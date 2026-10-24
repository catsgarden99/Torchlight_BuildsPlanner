> # ⛔ 项目已废弃（DEPRECATED）
>
> **大肥鱼太笨，项目已废弃。** 本仓库不再维护，内容仅作留档，请勿参考或使用。

# 火炬之光：无限 · BD 构建规划器

自用工具。解决四件事：**词条怎么搭**、**buff 从哪来**、**我到底有没有**、**补它划不划算**。
不做第二个 DPS 计算器（社区已有成熟工具），只做它的**上游决策层**。

- 目标版本：国服 **SS14「困兽」**（2026/10/16 起）
- 当前状态：**M0 可运行原型**（结构与交互已可用，数据是手工种子子集，见下）
- 详细设计：**[docs/PLAN.md](docs/PLAN.md)**

---

## 30 秒上手

**方式一（推荐）**：双击 `启动规划器.cmd` —— 用浏览器应用模式打开，无地址栏、无标签页，可固定到任务栏。

**方式二**：直接双击 `index.html`。

> 不需要装任何东西，**不需要启动服务器**。它是纯静态页面：数据以 `<script>` 注入，
> 不走 `fetch`、不用 ES Module，所以 `file://` 直开就行。改完文件 `F5` 即生效。

存档：自动存 `localStorage`；若浏览器在 `file://` 下禁用了存储，界面会提示，
此时用「导出存档 / 导入存档」走 JSON 文件。

---

## 现在能做什么（M0）

| 功能 | 状态 |
|---|---|
| 左侧按 buff 家族筛选 + 全库搜索（buff 名、来源名、词条原文） | ✅ |
| 中间面板分两块：**获取来源**（从哪拿）与 **上下限与条件**（能叠多少 / 需要什么） | ✅ |
| **自动候选来源**：从天赋 / 传奇 / 契灵 / 技能里按关键字捞出的 358 条线索，独立分组默认折叠 | ✅ |
| 每条来源的代价徽标（词条位 / 技能位 / 辅助位 / 天赋点 / 锁英雄 / 负担）与代价分 | ✅ |
| 「已在配置」勾选 → 实时推导实际层数与状态（🟢🟡🔵🔴⚪） | ✅ |
| 目标层数 / 我已实测 两个输入 → **理论有但实测无** 会被标红 | ✅ |
| 右侧缺口看板：按代价排序给出「最便宜的补法」，点一下即加入配置 | ✅ |
| 聚合 buff（任意祝福 = 三种祝福之和）自动汇总子 buff | ✅ |
| 存档导出 / 导入 JSON | ✅ |
| **全库命中**：抓到的 15.7k 条文本里，凡含该 buff 关键字的自动列出（带来源名 / 页面 / T 级 / 侵蚀标记） | ✅ |
| 全量数据 | 🟡 词条 13.9k 条、技能 919、天赋 1236、契灵 180、英雄特性 6（猫3） |
| 性价比排序（含火价）/ 缺口组合求解 / 词条搭配器 | ⬜ M4~M5 |

### 数据完整度说明（重要）

数据有三种来源，界面上分开标注：

1. **人工核实的来源**（`data/sources.js`，22 条）：逐条摘录原文，标 `原文`，可核对。
2. **自动候选来源**（`data/sources-auto.js`，358 条）：从天赋 1236 / 传奇 338 / 契灵 180 / 技能里按关键字 + 句式捞出的线索，
   标 `自动`，**不参与层数推导**，只用来回答"这东西还能从哪拿"。
3. **全库命中**（`data/index.js`）：更粗的文本索引（15.7k 条），按页面统计分布。

石板说明：tlidb 的 `Divinity_Slate` 页里「传奇 / 非传奇神格石板」就是**同一批天赋点**
（id 与 `Talent` 页 100% 重合，1236 条），所以石板能提供的词缀 = 天赋词缀，已在天赋数据里，不重复收录。

当前已核实的人工条目：祝福体系（聚能/坚韧/灵动/任意）、传奇 2 件、光环 5 条、光环辅助 7 条、
猫眼主技能「碎月弧光斩」的月晕/连携点、猫3 六条英雄特性（寻仇 / 凌厉 / 迅捷 / 灵动祝福联动）。

> 刻意不含其它英雄的特性：用不上的内容留在库里只会稀释判断。

### 我的 BD（`data/profile.js`）

猫眼·艾瑞卡 · **寻仇之刺（猫3）**，主技能 **碎月弧光斩**（`Crescent_Slash`，标签：攻击/近战/范围/物理/连携/敏捷/持续）。

六条特性与它们牵动的 buff：

| 特性 | 需求等级 | 作用 |
|---|---|---|
| 寻仇之刺 | 1 | 提供**寻仇**（替换第三个技能槽）；释放寻仇 → 获得**凌厉** |
| 双刃齐下 | 45 | 双持时 +30% 攻击伤害、返还转持续回复 |
| 袖手悠游 | 60 | 有**迅捷**时寻仇无冷却；凌厉期间手动核心技能 -80% 伤害 |
| 疾影潜踪 | 60 | 寻仇→无尽寻仇；凌厉 +333% 持续 / +99% 效果 |
| 猫不可忍 | 75 | 暴击率换"寻仇多触发一次"的概率 |
| 命悬一线 | 75 | 每层**灵动祝福** +40% 凌厉效果（上限 10 层），代价是近身承伤 |

关注列表里的 buff 在左侧带 ★ 并排在最前；锁定在别的英雄上的来源会标 `需换英雄` 并压暗。

---

## 目录结构

```
index.html                 入口（双击开）
启动规划器.cmd              应用模式启动（无地址栏窗口）
assets/app.js              界面 + 判定引擎（普通脚本，全局命名空间 TLI）
assets/styles.css          深色主题
data/meta.js               赛季 / 数据状态 / 代价权重（权重可自己改）
data/profile.js            我的 BD 画像（英雄 / 特性 / 主技能）
data/buffs.js              buff 词典
data/sources.js            来源边（人工核实 + 原文摘录）
data/sources-auto.js       自动生成：358 条候选来源（天赋/传奇/契灵/技能）
data/index.js              自动生成：buff ← 词条 反向索引
data/skills.js             自动生成：919 个技能（名称 / 标签 / 详情文本）
data/heroes.js             自动生成：英雄特性（含 5 个特性等级的全部词条）
data/talents.js            自动生成：1236 个天赋 / 核心天赋
data/pactspirits.js        自动生成：180 个契灵（530 条词条）
data/raw/                  抓取的原始 HTML（gitignore）
data/parsed/               解析中间产物（gitignore）
docs/PLAN.md               总体方案（形态选型 / 数据模型 / 判定算法 / 路线图）
tools/pages.json           抓取清单（约 60 页）
tools/fetch-tlidb.mjs      阶段 A：原样抓取（断点续抓 + manifest + sha256）
tools/inspect-html.mjs     阶段 B：结构探测（先看再写解析器）
tools/parse-tlidb.mjs      阶段 C-1：HTML → 结构化 JSON（卡片式 + 表格式）
tools/parse-skills.mjs     阶段 C-2：技能列表页 + 详情页 → data/skills.js
tools/parse-heroes.mjs     阶段 C-3：英雄特性（data-tier-content）→ data/heroes.js
tools/parse-talents.mjs    阶段 C-3：天赋（data-id + data-source=attr）
tools/parse-pactspirits.mjs 阶段 C-3：契灵（class="modifier"）
tools/build-index.mjs      阶段 C-4：buff 关键字反向索引 → data/index.js
tools/build-sources.mjs    阶段 C-5：自动候选来源 → data/sources-auto.js
tools/smoke-dom.mjs        DOM 桩冒烟测试（无浏览器也能验证渲染）
```

---

## 数据路线

```bash
# A 抓取（--slug= 可按需补单个技能/装备页）
node tools/fetch-tlidb.mjs --list
node tools/fetch-tlidb.mjs --only=system,gear,hero,craft,skills
node tools/fetch-tlidb.mjs --slug=Crescent_Slash

# B 看结构（写解析器之前必做）
node tools/inspect-html.mjs data/raw/Crescent_Slash.html

# C 解析 + 索引
node tools/parse-tlidb.mjs        # → data/parsed/*.json（词条，未标注 0）
node tools/parse-skills.mjs       # → data/skills.js（919）
node tools/parse-heroes.mjs       # → data/heroes.js（特性）
node tools/parse-talents.mjs      # → data/talents.js（1236）
node tools/parse-pactspirits.mjs  # → data/pactspirits.js（180）
node tools/build-index.mjs        # → data/index.js
node tools/build-sources.mjs      # → data/sources-auto.js（358 条候选）

# D 自检（无浏览器也能跑）
node tools/smoke-dom.mjs
```

当前产物：**30 页 / 13,877 条词条 / 919 技能 / 1236 天赋 / 180 契灵**，
索引扫描 **15,690** 条文本、命中 **1,103** 条。

环境要求：**Node 18+**（脚本用内置 `fetch`，无依赖）。当前机器已验证 `node v22.23.2` 可用。

---

## 判定规则（当前实现）

```
granted = 稳态来源 ? 上限 : Σ 一次性层数        （聚合 buff 改为 Σ 子 buff 实际层数）
cap     = 基础上限 + Σ 数值型「上限」修饰       （未知则记 null，界面显示"上限未知"）
actual  = min(granted, cap)
best    = actual ?? 实测值
```

状态判定：`实测 < min(理论, 目标)` → 🔴 理论有·实测无；`best ≥ 目标` → 🟢；
`0 < best < 目标` → 🟡；`best == 0` → ⚪；上限未知 → 🔵。

代价分 = 火/20 + 词条位×2 + 技能位×2 + 辅助位×1 + 天赋点×0.3 + 锁英雄×6 + 负担(0/1/2)。
权重在 `data/meta.js` 的 `costWeights`，改完刷新即可。

---

## 数据来源与致谢

- [tlidb.com（火炬编年史）](https://tlidb.com/cn/) —— 词条/技能/传奇/天赋数据的原始来源，本项目所有原文摘录均出自该站。
- [aclinia/torchlight-of-building](https://github.com/aclinia/torchlight-of-building)（MIT）—— 其"从 tlidb 生成全量数据 + mod 模板解析"的思路与结构是本项目的重要参考；其在线版为 [tlipob.com](https://tlipob.com/)。
- 官方更新日志（SS14 困兽）：<https://torchlight.xd.cn/ss14pn>

本项目仅个人研究使用，不分发原始页面内容。
