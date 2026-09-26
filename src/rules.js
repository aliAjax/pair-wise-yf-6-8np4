// 账目规则层：纯函数，只负责校验与状态流转，不碰存储和页面。
// 每个动作返回 { state, error }：成功时 state 为新状态，失败时 error 为提示文案。

export const REPAIR_STATUS = { todo: "待处理", doing: "处理中", done: "已完成" };
export const REPAIR_PRIORITY = { high: "高优先级", medium: "中优先级", low: "低优先级" };
export const CLAIM_STATUS = { pending: "申请中", reimbursed: "已报销", rejected: "已退回", canceled: "已撤销" };
export const INVOICE_STATUS = { active: "当前", replaced: "已更换" };

const now = () => new Date().toISOString();
const clone = (state) => structuredClone(state);
const ok = (state) => ({ state, error: null });
const fail = (error) => ({ state: null, error });

export function roundMoney(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function isPositiveMoney(value) {
  return Number.isFinite(Number(value)) && roundMoney(value) > 0;
}

export function findRepair(state, repairId) {
  return state.repairs.find((repair) => repair.id === repairId) || null;
}

function findClaim(state, claimId) {
  return state.claims.find((claim) => claim.id === claimId) || null;
}

export function activeInvoiceOf(state, repairId) {
  return state.invoices.find((inv) => inv.repairId === repairId && inv.status === "active") || null;
}

export function claimsOf(state, repairId) {
  return state.claims.filter((claim) => claim.repairId === repairId);
}

// 有发票或报销流水的维修不能删除，保证旧账可核对
export function hasLedger(state, repairId) {
  return state.invoices.some((inv) => inv.repairId === repairId) || state.claims.some((claim) => claim.repairId === repairId);
}

// 同一发票号同一时间只能挂在一笔维修上（只看当前有效发票，历史留档不占号）
export function invoiceTakenBy(state, invoiceNo, exceptRepairId = null) {
  const hit = state.invoices.find(
    (inv) => inv.status === "active" && inv.invoiceNo === invoiceNo && inv.repairId !== exceptRepairId
  );
  return hit ? findRepair(state, hit.repairId) : null;
}

// 某笔维修的账目汇总：实付、申请中（占用）、已报销、可报销余额
export function accountOf(state, repairId) {
  const invoice = activeInvoiceOf(state, repairId);
  const claims = claimsOf(state, repairId);
  const sumBy = (status) => roundMoney(claims.filter((claim) => claim.status === status).reduce((total, claim) => total + claim.amount, 0));
  const pending = sumBy("pending");
  const reimbursed = sumBy("reimbursed");
  const paid = invoice ? invoice.paidAmount : 0;
  return { invoice, claims, paid, pending, reimbursed, available: roundMoney(paid - pending - reimbursed) };
}

// 全部维修的账目汇总，供报销流水页核对
export function ledgerSummary(state) {
  const paid = roundMoney(state.invoices.filter((inv) => inv.status === "active").reduce((total, inv) => total + inv.paidAmount, 0));
  const sumBy = (status) => roundMoney(state.claims.filter((claim) => claim.status === status).reduce((total, claim) => total + claim.amount, 0));
  const pending = sumBy("pending");
  const reimbursed = sumBy("reimbursed");
  return {
    doneCount: state.repairs.filter((repair) => repair.status === "done").length,
    paid,
    pending,
    reimbursed,
    available: roundMoney(paid - pending - reimbursed)
  };
}

function checkInvoicePayload(state, repairId, { invoiceNo, paidAmount, payer }) {
  const no = String(invoiceNo || "").trim();
  const who = String(payer || "").trim();
  const paid = roundMoney(paidAmount);
  if (!no) return { error: "请填写发票号" };
  if (!isPositiveMoney(paidAmount)) return { error: "实付金额需大于 0" };
  if (!who) return { error: "请填写垫付人" };
  const holder = invoiceTakenBy(state, no, repairId);
  if (holder) return { error: `发票号 ${no} 已用于「${holder.location}」的维修，一张发票不能重复登记` };
  return { invoiceNo: no, paidAmount: paid, payer: who };
}

function appendInvoice(next, repairId, checked) {
  next.invoices.unshift({
    id: crypto.randomUUID(),
    repairId,
    invoiceNo: checked.invoiceNo,
    paidAmount: checked.paidAmount,
    payer: checked.payer,
    status: "active",
    registeredAt: now(),
    replacedAt: null,
    replaceReason: ""
  });
}

// 新增维修事项
export function addRepair(state, data) {
  const location = String(data.location || "").trim();
  const title = String(data.title || "").trim();
  if (!location || !title) return fail("请填写位置与问题描述");
  const cost = Number.isFinite(Number(data.cost)) && Number(data.cost) > 0 ? roundMoney(data.cost) : 0;
  const next = clone(state);
  next.repairs.unshift({
    id: crypto.randomUUID(),
    location,
    title,
    priority: REPAIR_PRIORITY[data.priority] ? data.priority : "medium",
    cost,
    status: ["todo", "doing"].includes(data.status) ? data.status : "todo",
    photo: String(data.photo || "").trim(),
    note: String(data.note || "").trim(),
    createdAt: now(),
    completedAt: null
  });
  return ok(next);
}

// 状态调整：仅允许 待处理/处理中 之间切换；完工必须走完工登记
export function setRepairStatus(state, repairId, status) {
  const repair = findRepair(state, repairId);
  if (!repair) return fail("维修事项不存在");
  if (repair.status === "done") return fail("已完工的维修不能改回未完工");
  if (!["todo", "doing"].includes(status)) return fail("完工请使用「完工登记」，并填写发票信息");
  const next = clone(state);
  findRepair(next, repairId).status = status;
  return ok(next);
}

// 完工登记：状态置为已完成，同时登记发票号、实付金额、垫付人
export function completeRepair(state, repairId, payload) {
  const repair = findRepair(state, repairId);
  if (!repair) return fail("维修事项不存在");
  if (repair.status === "done") return fail("该维修已完工，无需重复登记");
  const checked = checkInvoicePayload(state, repairId, payload);
  if (checked.error) return fail(checked.error);
  const next = clone(state);
  const target = findRepair(next, repairId);
  target.status = "done";
  target.completedAt = now();
  appendInvoice(next, repairId, checked);
  return ok(next);
}

// 补登发票：旧账里已完工但没登记发票的维修
export function registerInvoice(state, repairId, payload) {
  const repair = findRepair(state, repairId);
  if (!repair) return fail("维修事项不存在");
  if (repair.status !== "done") return fail("未完工不能登记发票与报销");
  if (activeInvoiceOf(state, repairId)) return fail("该维修已有当前发票，如需更正请使用「换发票」");
  const checked = checkInvoicePayload(state, repairId, payload);
  if (checked.error) return fail(checked.error);
  const next = clone(state);
  appendInvoice(next, repairId, checked);
  return ok(next);
}

// 换发票：旧记录保留为「已更换」，新记录成为当前发票
export function changeInvoice(state, repairId, payload) {
  const repair = findRepair(state, repairId);
  if (!repair) return fail("维修事项不存在");
  if (repair.status !== "done") return fail("未完工的维修没有发票可换");
  const current = activeInvoiceOf(state, repairId);
  if (!current) return fail("该维修尚未登记发票");
  const reason = String(payload.reason || "").trim();
  if (!reason) return fail("换发票必须填写换票原因");
  const checked = checkInvoicePayload(state, repairId, payload);
  if (checked.error) return fail(checked.error);
  if (current.invoiceNo === checked.invoiceNo && current.paidAmount === checked.paidAmount && current.payer === checked.payer) {
    return fail("发票信息没有变化，无需换票");
  }
  // 收到的钱与占用中的钱不能超过新的实付金额
  const acc = accountOf(state, repairId);
  const locked = roundMoney(acc.pending + acc.reimbursed);
  if (checked.paidAmount < locked) {
    return fail(`实付金额不能低于已占用与已报销合计 ¥${locked}，请先处理申请中的报销`);
  }
  const next = clone(state);
  const old = next.invoices.find((inv) => inv.id === current.id);
  old.status = "replaced";
  old.replacedAt = now();
  old.replaceReason = reason;
  appendInvoice(next, repairId, checked);
  return ok(next);
}

// 提交报销：先占用申请金额（申请中 + 已报销 不得超过实付）
export function submitClaim(state, repairId, { amount, note }) {
  const repair = findRepair(state, repairId);
  if (!repair) return fail("维修事项不存在");
  if (repair.status !== "done") return fail("未完工不能报销，请先做完工登记");
  const invoice = activeInvoiceOf(state, repairId);
  if (!invoice) return fail("请先登记发票再申请报销");
  if (!isPositiveMoney(amount)) return fail("申请金额需大于 0");
  const value = roundMoney(amount);
  const acc = accountOf(state, repairId);
  if (value > acc.available) return fail(`申请金额超出可报销余额，当前最多还能申请 ¥${acc.available}`);
  const next = clone(state);
  next.claims.unshift({
    id: crypto.randomUUID(),
    repairId,
    invoiceId: invoice.id,
    invoiceNo: invoice.invoiceNo,
    amount: value,
    note: String(note || "").trim(),
    status: "pending",
    submittedAt: now(),
    settledAt: null,
    rejectedAt: null,
    canceledAt: null,
    rejectReason: "",
    cancelReason: ""
  });
  return ok(next);
}

// 到账：申请中 → 已报销
export function settleClaim(state, claimId) {
  const claim = findClaim(state, claimId);
  if (!claim) return fail("报销记录不存在");
  if (claim.status !== "pending") return fail("只有申请中的报销才能确认到账");
  const next = clone(state);
  const target = findClaim(next, claimId);
  target.status = "reimbursed";
  target.settledAt = now();
  return ok(next);
}

// 退回：必须填原因，金额恢复可用，记录保留
export function rejectClaim(state, claimId, reason) {
  const claim = findClaim(state, claimId);
  if (!claim) return fail("报销记录不存在");
  if (claim.status !== "pending") return fail("只有申请中的报销才能退回");
  const text = String(reason || "").trim();
  if (!text) return fail("退回时必须填写原因");
  const next = clone(state);
  const target = findClaim(next, claimId);
  target.status = "rejected";
  target.rejectReason = text;
  target.rejectedAt = now();
  return ok(next);
}

// 撤销：申请方主动撤回，记录保留，金额恢复可用
export function cancelClaim(state, claimId, reason = "") {
  const claim = findClaim(state, claimId);
  if (!claim) return fail("报销记录不存在");
  if (claim.status !== "pending") return fail("只有申请中的报销才能撤销");
  const next = clone(state);
  const target = findClaim(next, claimId);
  target.status = "canceled";
  target.cancelReason = String(reason || "").trim() || "主动撤销";
  target.canceledAt = now();
  return ok(next);
}

// 删除维修：有账目的维修不允许删除，旧账需保留备查
export function removeRepair(state, repairId) {
  const repair = findRepair(state, repairId);
  if (!repair) return fail("维修事项不存在");
  if (hasLedger(state, repairId)) return fail("该维修已有发票或报销流水，不能删除；旧账需保留备查");
  const next = clone(state);
  next.repairs = next.repairs.filter((item) => item.id !== repairId);
  return ok(next);
}
