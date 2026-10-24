#!/usr/bin/env node
/**
 * 冒烟测试：用最小 DOM 桩在 Node 里跑一遍 assets/app.js。
 *
 * 为什么需要它：本项目没有构建步骤，"打开页面才知道有没有报错"太晚。
 * 这个桩能在 1 秒内验证：初始渲染不抛异常、关键区块都渲染出来、localStorage 不可用时会降级。
 *
 * 用法：node tools/smoke-dom.mjs
 * 退出码：0 = 通过；1 = 渲染抛错或关键区块缺失。
 */
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function makeElement() {
  return {
    innerHTML: "",
    value: "",
    dataset: {},
    checked: false,
    files: null,
    firstChild: null,
    closest: () => null,
    replaceWith() {},
    appendChild() {},
    removeChild() {},
    click() {},
  };
}

const app = makeElement();
const listeners = {};
const document = {
  getElementById: (id) => (id === "app" ? app : makeElement()),
  addEventListener: (type, handler) => {
    listeners[type] = handler;
  },
  querySelector: () => null,
  createElement: () => makeElement(),
  body: { appendChild() {}, removeChild() {} },
};
const storage = {
  getItem() {
    throw new Error("storage blocked (simulating file://)");
  },
  setItem() {
    throw new Error("storage blocked (simulating file://)");
  },
};

const sandbox = {
  window: { localStorage: storage, setTimeout: () => 0, addEventListener() {} },
  document,
  console,
  Date,
  JSON,
  Math,
  Number,
  String,
  Object,
  Array,
  parseInt,
  isNaN,
  Blob: class {},
  URL: { createObjectURL: () => "", revokeObjectURL() {} },
  FileReader: class {},
};
sandbox.window.document = document;
vm.createContext(sandbox);

const dataFiles = ["meta.js", "profile.js", "buffs.js", "sources.js", "index.js"];
for (const file of dataFiles) {
  const full = path.join(ROOT, "data", file);
  vm.runInContext(readFileSync(full, "utf8"), sandbox, { filename: `data/${file}` });
}
vm.runInContext(readFileSync(path.join(ROOT, "assets", "app.js"), "utf8"), sandbox, { filename: "assets/app.js" });

const rendered = app.innerHTML;
const required = ["buff 家族", "获取来源", "上下限与条件", "全库命中", "本地存储不可用"];
const missing = required.filter((needle) => !rendered.includes(needle));

console.log(`渲染 ${rendered.length} 字符，绑定事件：${Object.keys(listeners).join(",") || "（无）"}`);
for (const needle of required) console.log(`  ${rendered.includes(needle) ? "✓" : "✗"} ${needle}`);

if (missing.length > 0) {
  console.error(`\n缺失区块：${missing.join("、")}`);
  process.exitCode = 1;
} else {
  console.log("\n冒烟测试通过");
}
