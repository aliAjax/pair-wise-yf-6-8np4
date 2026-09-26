// 账目规则测试：node --test
import test from "node:test";
import assert from "node:assert/strict";
import {
  addRepair,
  setRepairStatus,
  completeRepair,
  registerInvoice,
  changeInvoice,
  submitClaim,
  settleClaim,
  rejectClaim,
  cancelClaim,
  removeRepair,
  accountOf,
  ledgerSummary
} from "./rules.js";

function baseState() {
  return {
    tab: "repairs",
    filter: "all",
    repairs: [
      { id: "r1", location: "厨房", title: "水槽渗水", priority: "high", cost: 260, status: "doing", photo: "", note: "", createdAt: "2026-09-01T00:00:00.000Z", completedAt: null },
      { id: "r2", location: "卫生间", title: "花洒更换", priority: "medium", cost: 400, status: "todo", photo: "", note: "", createdAt: "2026-09-01T00:00:00.000Z", completedAt: null }
    ],
    invoices: [],
    claims: []
  };
}

// r1 已完工并登记发票：发票号 INV-001，实付 380，垫付人 妈妈
function doneState() {
  const result = completeRepair(baseState(), "r1", { invoiceNo: "INV-001", paidAmount: 380, payer: "妈妈" });
  assert.equal(result.error, null);
  return result.state;
}

test("完工登记：记录发票号、实付金额和垫付人", () => {
  const state = doneState();
  const repair = state.repairs.find((item) => item.id === "r1");
  assert.equal(repair.status, "done");
  assert.ok(repair.completedAt);
  const invoice = state.invoices.find((inv) => inv.repairId === "r1");
  assert.equal(invoice.invoiceNo, "INV-001");
  assert.equal(invoice.paidAmount, 380);
  assert.equal(invoice.payer, "妈妈");
  assert.equal(invoice.status, "active");
});

test("完工登记：发票号、实付金额、垫付人缺一不可", () => {
  assert.match(completeRepair(baseState(), "r1", { invoiceNo: "", paidAmount: 100, payer: "妈妈" }).error, /发票号/);
  assert.match(completeRepair(baseState(), "r1", { invoiceNo: "INV-1", paidAmount: 0, payer: "妈妈" }).error, /大于 0/);
  assert.match(completeRepair(baseState(), "r1", { invoiceNo: "INV-1", paidAmount: 100, payer: "" }).error, /垫付人/);
  assert.match(completeRepair(doneState(), "r1", { invoiceNo: "INV-2", paidAmount: 100, payer: "妈妈" }).error, /已完工/);
});

test("一张发票不能同时用于两笔维修", () => {
  const result = completeRepair(doneState(), "r2", { invoiceNo: "INV-001", paidAmount: 100, payer: "爸爸" });
  assert.match(result.error, /已用于「厨房」/);
});

test("未完工不能报销", () => {
  assert.match(submitClaim(baseState(), "r1", { amount: 100, note: "" }).error, /未完工不能报销/);
});

test("旧账：已完工但未登记发票也不能报销，补登后可以", () => {
  const legacy = baseState();
  legacy.repairs[0].status = "done"; // 旧数据直接就是已完成，没有发票
  assert.match(submitClaim(legacy, "r1", { amount: 100, note: "" }).error, /登记发票/);
  const registered = registerInvoice(legacy, "r1", { invoiceNo: "INV-009", paidAmount: 200, payer: "爸爸" });
  assert.equal(registered.error, null);
  assert.equal(submitClaim(registered.state, "r1", { amount: 100, note: "" }).error, null);
});

test("提交报销先占用额度，超出可报销余额被拦截", () => {
  let state = doneState();
  const first = submitClaim(state, "r1", { amount: 200, note: "材料" });
  assert.equal(first.error, null);
  state = first.state;
  const acc = accountOf(state, "r1");
  assert.equal(acc.pending, 200);
  assert.equal(acc.reimbursed, 0);
  assert.equal(acc.available, 180);
  assert.match(submitClaim(state, "r1", { amount: 200, note: "" }).error, /超出可报销余额/);
  assert.equal(submitClaim(state, "r1", { amount: 180, note: "" }).error, null);
  assert.match(submitClaim(state, "r1", { amount: 0, note: "" }).error, /大于 0/);
  assert.match(submitClaim(state, "r1", { amount: "abc", note: "" }).error, /大于 0/);
});

test("到账后转为已报销，累计收到的钱不超过实付", () => {
  let state = doneState();
  state = submitClaim(state, "r1", { amount: 380, note: "" }).state;
  const claimId = state.claims[0].id;
  state = settleClaim(state, claimId).state;
  const acc = accountOf(state, "r1");
  assert.equal(acc.reimbursed, 380);
  assert.equal(acc.available, 0);
  assert.ok(acc.reimbursed <= acc.paid);
  // 已到账的不能重复操作
  assert.match(settleClaim(state, claimId).error, /申请中/);
  assert.match(rejectClaim(state, claimId, "x").error, /申请中/);
  assert.match(cancelClaim(state, claimId).error, /申请中/);
});

test("退回必须填原因，退回后金额恢复可用且记录保留", () => {
  let state = doneState();
  state = submitClaim(state, "r1", { amount: 150, note: "" }).state;
  const claimId = state.claims[0].id;
  assert.match(rejectClaim(state, claimId, "  ").error, /原因/);
  state = rejectClaim(state, claimId, "发票抬头有误").state;
  const claim = state.claims[0];
  assert.equal(claim.status, "rejected");
  assert.equal(claim.rejectReason, "发票抬头有误");
  assert.ok(claim.rejectedAt);
  assert.equal(accountOf(state, "r1").available, 380);
  assert.equal(state.claims.length, 1); // 记录保留
});

test("撤销申请保留旧记录并恢复可用", () => {
  let state = doneState();
  state = submitClaim(state, "r1", { amount: 120, note: "" }).state;
  const claimId = state.claims[0].id;
  state = cancelClaim(state, claimId).state;
  assert.equal(state.claims[0].status, "canceled");
  assert.equal(state.claims[0].cancelReason, "主动撤销");
  assert.equal(accountOf(state, "r1").available, 380);
  assert.equal(state.claims.length, 1); // 记录保留
});

test("换发票保留旧记录，换票原因必填", () => {
  assert.match(changeInvoice(doneState(), "r1", { invoiceNo: "INV-002", paidAmount: 380, payer: "妈妈", reason: "" }).error, /换票原因/);
  const result = changeInvoice(doneState(), "r1", { invoiceNo: "INV-002", paidAmount: 380, payer: "妈妈", reason: "原票作废重开" });
  assert.equal(result.error, null);
  const state = result.state;
  assert.equal(state.invoices.length, 2);
  const old = state.invoices.find((inv) => inv.invoiceNo === "INV-001");
  assert.equal(old.status, "replaced");
  assert.equal(old.replaceReason, "原票作废重开");
  assert.ok(old.replacedAt);
  const current = state.invoices.find((inv) => inv.status === "active");
  assert.equal(current.invoiceNo, "INV-002");
  // 信息完全不变时不允许换票
  assert.match(changeInvoice(doneState(), "r1", { invoiceNo: "INV-001", paidAmount: 380, payer: "妈妈", reason: "试试" }).error, /没有变化/);
});

test("换发票时实付不能低于已占用与已报销合计", () => {
  let state = doneState();
  state = submitClaim(state, "r1", { amount: 200, note: "" }).state;
  state = settleClaim(state, state.claims[0].id).state; // 已报销 200
  state = submitClaim(state, "r1", { amount: 100, note: "" }).state; // 占用 100
  assert.match(
    changeInvoice(state, "r1", { invoiceNo: "INV-002", paidAmount: 250, payer: "妈妈", reason: "金额更正" }).error,
    /不能低于已占用与已报销合计 ¥300/
  );
  assert.equal(changeInvoice(state, "r1", { invoiceNo: "INV-002", paidAmount: 300, payer: "妈妈", reason: "金额更正" }).error, null);
});

test("有账目的维修不能删除，旧账保留备查", () => {
  const state = doneState();
  assert.match(removeRepair(state, "r1").error, /不能删除/);
  const clean = removeRepair(state, "r2");
  assert.equal(clean.error, null);
  assert.equal(clean.state.repairs.length, 1);
});

test("完工只能走完工登记，已完工不能改回", () => {
  assert.match(setRepairStatus(baseState(), "r1", "done").error, /完工登记/);
  const state = setRepairStatus(baseState(), "r1", "todo").state;
  assert.equal(state.repairs[0].status, "todo");
  assert.match(setRepairStatus(doneState(), "r1", "doing").error, /已完工/);
});

test("新增维修事项需要位置与问题描述", () => {
  assert.match(addRepair(baseState(), { location: "", title: "灯不亮" }).error, /位置与问题描述/);
  const result = addRepair(baseState(), { location: "卧室", title: "灯不亮", priority: "low", cost: "80", status: "todo", photo: "", note: "" });
  assert.equal(result.error, null);
  assert.equal(result.state.repairs.length, 3);
  assert.equal(result.state.repairs[0].cost, 80);
});

test("账目汇总：申请中 + 已报销 + 可报销 = 实付", () => {
  let state = doneState();
  state = submitClaim(state, "r1", { amount: 100, note: "" }).state;
  state = settleClaim(state, state.claims[0].id).state;
  state = submitClaim(state, "r1", { amount: 50, note: "" }).state;
  const summary = ledgerSummary(state);
  assert.equal(summary.paid, 380);
  assert.equal(summary.reimbursed, 100);
  assert.equal(summary.pending, 50);
  assert.equal(summary.available, 230);
  assert.equal(summary.doneCount, 1);
});
