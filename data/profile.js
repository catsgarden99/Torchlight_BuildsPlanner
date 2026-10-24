// 我自己的 BD 画像：规划器据此把「需换英雄」的来源标灰、把缺口按我的实际路线排序。
// 改这里不用改代码，刷新即可。
window.TLI_PROFILE = {
  season: "SS14",
  hero: {
    id: "erika",
    name: "艾瑞卡",
    title: "猫眼",
    trait: "寻仇之刺",
    traitSlug: "Vendettas_Sting",
    note: "猫3",
  },
  // 主技能：碎月弧光斩（标签：攻击/近战/范围/物理/连携/敏捷/持续）
  mainSkill: {
    name: "碎月弧光斩",
    slug: "Crescent_Slash",
    tags: ["攻击", "近战", "范围", "物理", "连携", "敏捷", "持续"],
    grants: ["moon_halo"],
    consumes: ["combo_point"],
  },
  // 猫3 的六条特性（来自 tlidb 英雄页，等级 = 特性等级上限）
  traits: [
    { name: "寻仇之刺", reqLevel: 1, provides: ["vendetta", "incisive"] },
    { name: "双刃齐下", reqLevel: 45, provides: [] },
    { name: "袖手悠游", reqLevel: 60, requires: ["swiftness"] },
    { name: "疾影潜踪", reqLevel: 60, modifies: ["incisive", "vendetta"] },
    { name: "猫不可忍", reqLevel: 75, modifies: ["vendetta"] },
    { name: "命悬一线", reqLevel: 75, requires: ["blessing.agility"], modifies: ["incisive"] },
  ],
  // 我关心的目标：默认只在这些 buff 上算缺口（空数组 = 全部）
  focusBuffIds: ["vendetta", "incisive", "swiftness", "blessing.agility", "moon_halo", "combo_point"],
};
