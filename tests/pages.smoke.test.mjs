import test from "node:test";
import assert from "node:assert/strict";

// 最小 DOM 桩：只支撑 pages.js 用到的 querySelector / querySelectorAll / innerHTML
const elements = new Map();
function makeEl() {
  return { innerHTML: "", addEventListener() {} };
}

globalThis.document = {
  querySelector(sel) {
    if (!elements.has(sel)) elements.set(sel, makeEl());
    return elements.get(sel);
  },
  querySelectorAll() {
    return [];
  }
};

const mem = new Map();
globalThis.localStorage = {
  getItem: (key) => (mem.has(key) ? mem.get(key) : null),
  setItem: (key, value) => mem.set(key, String(value))
};

const { startApp } = await import("../src/pages.js");

test("页面渲染冒烟：关键区块齐全", () => {
  startApp();
  const html = elements.get("#app").innerHTML;
  assert.match(html, /维修报销账本/);
  assert.match(html, /待收（占用中）/);
  assert.match(html, /已报销/);
  assert.match(html, /新增维修事项/);
  assert.match(html, /报销流水/);
});
