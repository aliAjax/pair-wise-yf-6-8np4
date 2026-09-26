// 页面渲染冒烟测试：用最小 DOM 桩验证两个页面的模板能完整渲染。
import test from "node:test";
import assert from "node:assert/strict";
import { renderRepairsPage } from "./repairsPage.js";
import { renderLedgerPage } from "./ledgerPage.js";
import { completeRepair, submitClaim, rejectClaim, changeInvoice } from "../rules.js";

function fakeContainer() {
  return {
    innerHTML: "",
    querySelector: () => ({ addEventListener: () => {} }),
    querySelectorAll: () => []
  };
}

const noopActions = new Proxy({}, { get: () => () => {} });
const closedUi = { complete: null, claim: null, invoice: null, reject: null, ledgerFilter: "all" };

// 一笔待处理 + 一笔已完工（有发票、申请中、已退回、换票记录）
function sampleState() {
  let state = {
    tab: "repairs",
    filter: "all",
    repairs: [
      { id: "r1", location: "厨房", title: "水槽渗水", priority: "high", cost: 260, status: "todo", photo: "", note: "", createdAt: null, completedAt: null },
      { id: "r2", location: "卫生间", title: "花洒更换", priority: "medium", cost: 400, status: "doing", photo: "", note: "", createdAt: null, completedAt: null }
    ],
    invoices: [],
    claims: []
  };
  state = completeRepair(state, "r2", { invoiceNo: "INV-001", paidAmount: 380, payer: "妈妈" }).state;
  state = changeInvoice(state, "r2", { invoiceNo: "INV-002", paidAmount: 380, payer: "妈妈", reason: "原票作废重开" }).state;
  state = submitClaim(state, "r2", { amount: 100, note: "材料费" }).state;
  const claimId = state.claims[0].id;
  state = submitClaim(state, "r2", { amount: 50, note: "上门费" }).state;
  state = rejectClaim(state, state.claims[0].id, "发票抬头有误").state;
  return { state, claimId };
}

test("维修事项页：渲染完工登记、发票信息与报销操作", () => {
  const { state } = sampleState();
  const container = fakeContainer();
  renderRepairsPage(container, state, closedUi, noopActions);
  const html = container.innerHTML;
  assert.match(html, /完工登记/); // 未完工的维修
  assert.match(html, /INV-002/); // 当前发票
  assert.match(html, /实付 ¥380/);
  assert.match(html, /垫付人 妈妈/);
  assert.match(html, /申请报销/);
  assert.match(html, /换发票/);
  assert.match(html, /申请中 ¥100/);
  assert.match(html, /退回原因：发票抬头有误/);
});

test("维修事项页：展开完工登记表单", () => {
  const { state } = sampleState();
  const container = fakeContainer();
  renderRepairsPage(container, state, { ...closedUi, complete: "r1" }, noopActions);
  assert.match(container.innerHTML, /完工并登记发票/);
});

test("报销流水页：渲染汇总、流水与发票档案", () => {
  const { state } = sampleState();
  const container = fakeContainer();
  renderLedgerPage(container, state, closedUi, noopActions);
  const html = container.innerHTML;
  assert.match(html, /实付合计/);
  assert.match(html, /可报销余额/);
  assert.match(html, /报销流水/);
  assert.match(html, /发票档案/);
  assert.match(html, /INV-001/); // 已更换的旧发票留档
  assert.match(html, /已更换/);
  assert.match(html, /已退回/);
  assert.match(html, /申请中/);
});

test("报销流水页：按状态筛选", () => {
  const { state } = sampleState();
  const container = fakeContainer();
  renderLedgerPage(container, state, { ...closedUi, ledgerFilter: "rejected" }, noopActions);
  const html = container.innerHTML;
  assert.match(html, /发票抬头有误/);
  assert.doesNotMatch(html, /材料费/); // 申请中的记录被过滤掉
});
