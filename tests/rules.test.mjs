import test from "node:test";
import assert from "node:assert/strict";
import {
  LedgerError,
  addRepair,
  setRepairStatus,
  deleteRepair,
  completeRepair,
  registerInvoice,
  submitRequest,
  markReceived,
  markReturned,
  cancelRequest,
  repairBalance,
  totals,
  toCents,
  formatCents
} from "../src/rules.js";

const NOW = "2026-09-26T08:00:00.000Z";

// 造两笔维修：一笔卫生间、一笔厨房
function makeState() {
  const state = { version: 2, filter: "all", repairs: [], requests: [] };
  const a = addRepair(state, { location: "卫生间", title: "水龙头漏水" });
  const b = addRepair(state, { location: "厨房", title: "水槽渗水" });
  return { state, a, b };
}

function complete(state, repairId, overrides = {}) {
  return completeRepair(state, repairId, { invoiceNo: "INV-001", actualPaid: "1000", payer: "妈妈", ...overrides }, NOW);
}

test("完工登记：记录发票号、实付金额和垫付人", () => {
  const { state, a } = makeState();
  complete(state, a.id, { actualPaid: "1234.56" });
  const repair = state.repairs.find((r) => r.id === a.id);
  assert.equal(repair.status, "done");
  assert.equal(repair.invoice.no, "INV-001");
  assert.equal(repair.invoice.actualPaidCents, 123456);
  assert.equal(repair.invoice.payer, "妈妈");
  assert.ok(repair.completedAt);
});

test("完工登记：三件套缺一不行，且不能重复完工", () => {
  const { state, a } = makeState();
  assert.throws(() => completeRepair(state, a.id, { invoiceNo: "", actualPaid: "100", payer: "妈妈" }, NOW), LedgerError);
  assert.throws(() => completeRepair(state, a.id, { invoiceNo: "INV-1", actualPaid: "0", payer: "妈妈" }, NOW), LedgerError);
  assert.throws(() => completeRepair(state, a.id, { invoiceNo: "INV-1", actualPaid: "100", payer: "" }, NOW), LedgerError);
  complete(state, a.id);
  assert.throws(() => complete(state, a.id), /无需重复登记/);
});

test("一张发票不能用于两笔维修", () => {
  const { state, a, b } = makeState();
  complete(state, a.id, { invoiceNo: "INV-SAME" });
  assert.throws(() => complete(state, b.id, { invoiceNo: "INV-SAME" }), /不能用于两笔维修/);
  complete(state, b.id, { invoiceNo: "INV-OTHER" });
});

test("未完工不能申请报销", () => {
  const { state, a } = makeState();
  assert.throws(() => submitRequest(state, a.id, { amount: "100" }, NOW), /未完工不能申请报销/);
});

test("提交报销先占用金额，占用后额度减少，不能超过实付", () => {
  const { state, a } = makeState();
  complete(state, a.id, { actualPaid: "1000" });
  submitRequest(state, a.id, { amount: "400" }, NOW);
  let balance = repairBalance(state, a.id);
  assert.equal(balance.pendingCents, 40000);
  assert.equal(balance.availableCents, 60000);
  assert.throws(() => submitRequest(state, a.id, { amount: "600.01" }, NOW), /额度不足/);
  submitRequest(state, a.id, { amount: "600" }, NOW);
  balance = repairBalance(state, a.id);
  assert.equal(balance.availableCents, 0);
});

test("到账后转为已报销，已报销合计不超过实付", () => {
  const { state, a } = makeState();
  complete(state, a.id, { actualPaid: "1000" });
  const r1 = submitRequest(state, a.id, { amount: "600" }, NOW);
  const r2 = submitRequest(state, a.id, { amount: "400" }, NOW);
  markReceived(state, r1.id, NOW);
  markReceived(state, r2.id, NOW);
  const balance = repairBalance(state, a.id);
  assert.equal(balance.receivedCents, 100000);
  assert.equal(balance.receivedCents <= balance.actualPaidCents, true);
  assert.equal(balance.availableCents, 0);
  assert.throws(() => submitRequest(state, a.id, { amount: "0.01" }, NOW), /额度不足/);
});

test("退回必须填原因，退回后额度恢复、记录保留", () => {
  const { state, a } = makeState();
  complete(state, a.id, { actualPaid: "1000" });
  const req = submitRequest(state, a.id, { amount: "400" }, NOW);
  assert.throws(() => markReturned(state, req.id, "  ", NOW), /退回必须填写原因/);
  markReturned(state, req.id, "发票抬头开错", NOW);
  const balance = repairBalance(state, a.id);
  assert.equal(balance.pendingCents, 0);
  assert.equal(balance.availableCents, 100000);
  const kept = state.requests.find((r) => r.id === req.id);
  assert.equal(kept.status, "returned");
  assert.equal(kept.returnReason, "发票抬头开错");
});

test("撤销申请保留记录并恢复额度", () => {
  const { state, a } = makeState();
  complete(state, a.id, { actualPaid: "1000" });
  const req = submitRequest(state, a.id, { amount: "400" }, NOW);
  cancelRequest(state, req.id, NOW);
  assert.equal(state.requests.length, 1);
  assert.equal(state.requests[0].status, "canceled");
  assert.equal(repairBalance(state, a.id).availableCents, 100000);
});

test("已到账/已退回/已撤销的申请不能再变动", () => {
  const { state, a } = makeState();
  complete(state, a.id, { actualPaid: "1000" });
  const r1 = submitRequest(state, a.id, { amount: "100" }, NOW);
  const r2 = submitRequest(state, a.id, { amount: "100" }, NOW);
  const r3 = submitRequest(state, a.id, { amount: "100" }, NOW);
  markReceived(state, r1.id, NOW);
  markReturned(state, r2.id, "票据模糊", NOW);
  cancelRequest(state, r3.id, NOW);
  for (const id of [r1.id, r2.id, r3.id]) {
    assert.throws(() => markReceived(state, id, NOW), LedgerError);
    assert.throws(() => markReturned(state, id, "原因", NOW), LedgerError);
    assert.throws(() => cancelRequest(state, id, NOW), LedgerError);
  }
});

test("换发票保留旧记录，旧发票号释放后可再用于其他维修", () => {
  const { state, a, b } = makeState();
  complete(state, a.id, { invoiceNo: "INV-OLD", actualPaid: "800" });
  registerInvoice(state, a.id, { invoiceNo: "INV-NEW", actualPaid: "800", payer: "妈妈", reason: "抬头开错重开" }, NOW);
  const repair = state.repairs.find((r) => r.id === a.id);
  assert.equal(repair.invoice.no, "INV-NEW");
  assert.equal(repair.invoiceHistory.length, 1);
  assert.equal(repair.invoiceHistory[0].no, "INV-OLD");
  assert.equal(repair.invoiceHistory[0].reason, "抬头开错重开");
  // 旧发票号已释放，别的维修可以用
  complete(state, b.id, { invoiceNo: "INV-OLD" });
  // 但新发票号仍被占用
  assert.throws(() => registerInvoice(state, b.id, { invoiceNo: "INV-NEW", actualPaid: "100", payer: "爸爸" }, NOW), /不能用于两笔维修/);
});

test("换发票时实付不能低于待收与已报销合计", () => {
  const { state, a } = makeState();
  complete(state, a.id, { actualPaid: "1000" });
  const req = submitRequest(state, a.id, { amount: "600" }, NOW);
  markReceived(state, req.id, NOW);
  submitRequest(state, a.id, { amount: "300" }, NOW);
  assert.throws(
    () => registerInvoice(state, a.id, { invoiceNo: "INV-2", actualPaid: "800", payer: "妈妈" }, NOW),
    /不能低于待收与已报销合计/
  );
  registerInvoice(state, a.id, { invoiceNo: "INV-2", actualPaid: "900", payer: "妈妈" }, NOW);
  assert.equal(repairBalance(state, a.id).availableCents, 0);
});

test("已完工的维修不能改回未完工，也不能删除", () => {
  const { state, a, b } = makeState();
  complete(state, a.id);
  assert.throws(() => setRepairStatus(state, a.id, "todo"), /不能改回/);
  assert.throws(() => deleteRepair(state, a.id), /不能删除/);
  setRepairStatus(state, b.id, "doing");
  deleteRepair(state, b.id);
  assert.equal(state.repairs.length, 1);
});

test("头部汇总：待收与已报销分开统计", () => {
  const { state, a, b } = makeState();
  complete(state, a.id, { invoiceNo: "INV-A", actualPaid: "1000" });
  complete(state, b.id, { invoiceNo: "INV-B", actualPaid: "500" });
  const r1 = submitRequest(state, a.id, { amount: "200" }, NOW);
  submitRequest(state, b.id, { amount: "100" }, NOW);
  markReceived(state, r1.id, NOW);
  const t = totals(state);
  assert.equal(t.unfinished, 0);
  assert.equal(t.pendingCents, 10000);
  assert.equal(t.receivedCents, 20000);
  assert.equal(t.availableCents, 120000);
});

test("金额解析与格式化", () => {
  assert.equal(toCents("12.34"), 1234);
  assert.equal(toCents(0.1), 10);
  assert.throws(() => toCents("abc"), LedgerError);
  assert.equal(formatCents(123456), "1,234.56");
  assert.equal(formatCents(-5), "-0.05");
});
