// 数据元信息：赛季、来源、完整度。所有产物都从这里读版本号，避免"这是哪一版数据"说不清。
window.TLI_META = {
  game: "火炬之光：无限",
  season: "SS14",
  seasonName: "困兽",
  locale: "zh-CN",
  dataStatus: "M0 种子数据",
  dataStatusNote: "仅收录已核实的祝福/光环/特性/传奇来源，用于验证结构与交互；全量词条待抓取（M1~M2）。",
  builtBy: "手工种子（来源：tlidb.com/cn 页面原文摘录）",
  sourceSite: "https://tlidb.com/cn/",
  families: {
    blessing: { label: "祝福", tone: "blessing" },
    aura: { label: "光环", tone: "aura" },
    buff: { label: "增益", tone: "buff" },
    resource: { label: "资源/充能", tone: "resource" },
    debuff: { label: "减益", tone: "debuff" },
    system: { label: "体系/机制", tone: "system" },
  },
  // 代价权重：性价比 = benefit / costScore。权重集中在这里，方便以后做成可调设置。
  costWeights: {
    currencyPerPoint: 20, // 每 20 火 = 1 分
    gearSlot: 2,
    skillSlot: 2,
    supportSlot: 1,
    talentPoint: 0.3,
    heroLock: 6,
    load: { 低: 0, 中: 1, 高: 2 },
  },
};
