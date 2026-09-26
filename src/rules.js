// 账目规则：完工登记、发票管理、报销申请的状态流转与校验。
// 本模块只做规则，不接触页面和存储；函数直接修改传入的 state，校验失败抛出 LedgerError。

export class LedgerError extends Error {
  constructor(message) {
    super(message);
    this.name = "LedgerError";
  }
}

export const REPAIR_STATUSES = { todo: "待处理", doing: "处理中", done: "已完工" };
export const REQUEST_STATUSES = { pending: "待收", received: "已报销", returned: "已退回", canceled: "已撤销" };

// ---------- 金额 ----------

// 金额一律以“分”存储，避免浮点误差。解析失败抛 LedgerError。
export function toCents(value) {
  const num = typeof value === "string" ? Number(value.trim()) : Number(value);
  if (!Number.isFinite(num)) throw new LedgerError("金额格式不正确");
  return Math.round(num * 100);
}

export function formatCents(cents) {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const yuan = String(Math.floor(abs / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${sign}${yuan}.${String(abs % 100).padStart(2, "0")}`;
}

// ---------- 查询 ----------

export function findRepair(state, repairId) {
  const repair = state.repairs.find((item) => item.id === repairId);
  if (!repair) throw new LedgerError("维修单不存在");
  return repair;
}

export function findRequest(state, requestId) {
  const request = state.requests.find((item) => item.id === requestId);
  if (!request) throw new LedgerError("报销申请不存在");
  return request;
}

// 发票号同一时间只能挂在一笔维修上
export function invoiceHolder(state, invoiceNo, exceptRepairId = null) {
  return state.repairs.find((repair) => repair.id !== exceptRepairId && repair.invoice && repair.invoice.no === invoiceNo) || null;
}

export function repairRequests(state, repairId) {
  return state.requests.filter((request) => request.repairId === repairId);
}

function sumByStatus(state, repairId, status) {
  return repairRequests(state, repairId)
    .filter((request) => request.status === status)
    .reduce((total, request) => total + request.amountCents, 0);
}

// 一笔维修的对账视图：实付、待收（占用中）、已报销、还可申请
export function repairBalance(state, repairId) {
  const repair = findRepair(state, repairId);
  const actualPaidCents = repair.invoice ? repair.invoice.actualPaidCents : 0;
  const pendingCents = sumByStatus(state, repairId, "pending");
  const receivedCents = sumByStatus(state, repairId, "received");
  return {
    actualPaidCents,
    pendingCents,
    receivedCents,
    availableCents: actualPaidCents - pendingCents - receivedCents
  };
}

export function totals(state) {
  let pendingCents = 0;
  let receivedCents = 0;
  for (const request of state.requests) {
    if (request.status === "pending") pendingCents += request.amountCents;
    if (request.status === "received") receivedCents += request.amountCents;
  }
  const availableCents = state.repairs
    .filter((repair) => repair.invoice)
    .reduce((total, repair) => total + repairBalance(state, repair.id).availableCents, 0);
  return {
    unfinished: state.repairs.filter((repair) => repair.status !== "done").length,
    pendingCents,
    receivedCents,
    availableCents
  };
}

// ---------- 维修单 ----------

export function addRepair(state, fields) {
  const location = (fields.location || "").trim();
  const title = (fields.title || "").trim();
  if (!location) throw new LedgerError("请填写位置");
  if (!title) throw new LedgerError("请填写问题描述");
  const repair = {
    id: crypto.randomUUID(),
    location,
    title,
    priority: fields.priority || "medium",
    estimatedCost: Number(fields.estimatedCost || 0) || 0,
    status: "todo",
    photo: (fields.photo || "").trim(),
    note: (fields.note || "").trim(),
    completedAt: null,
    invoice: null,
    invoiceHistory: []
  };
  state.repairs.unshift(repair);
  return repair;
}

// 未完工之间可以来回调整；已完工留有账目，不能改回
export function setRepairStatus(state, repairId, status) {
  const repair = findRepair(state, repairId);
  if (repair.status === "done") throw new LedgerError("已完工的维修不能改回未完工");
  if (!["todo", "doing"].includes(status)) throw new LedgerError("未知的处理状态");
  repair.status = status;
  return repair;
}

export function deleteRepair(state, repairId) {
  const repair = findRepair(state, repairId);
  if (repair.status === "done") throw new LedgerError("已完工的维修留有账目，不能删除");
  if (repairRequests(state, repairId).length) throw new LedgerError("该维修已有报销流水，不能删除");
  state.repairs = state.repairs.filter((item) => item.id !== repairId);
}

// ---------- 完工与发票 ----------

function checkInvoiceFields(state, repairId, fields) {
  const invoiceNo = (fields.invoiceNo || "").trim();
  const payer = (fields.payer || "").trim();
  if (!invoiceNo) throw new LedgerError("请填写发票号");
  if (!payer) throw new LedgerError("请填写垫付人");
  const actualPaidCents = toCents(fields.actualPaid);
  if (actualPaidCents <= 0) throw new LedgerError("实付金额必须大于 0");
  const holder = invoiceHolder(state, invoiceNo, repairId);
  if (holder) throw new LedgerError(`发票号 ${invoiceNo} 已用于「${holder.location}：${holder.title}」，一张发票不能用于两笔维修`);
  return { invoiceNo, payer, actualPaidCents };
}

// 完工登记：发票号 + 实付金额 + 垫付人，三件套缺一不可
export function completeRepair(state, repairId, fields, now = new Date().toISOString()) {
  const repair = findRepair(state, repairId);
  if (repair.status === "done") throw new LedgerError("该维修已完工，无需重复登记");
  const checked = checkInvoiceFields(state, repairId, fields);
  repair.status = "done";
  repair.completedAt = now;
  repair.invoice = { no: checked.invoiceNo, actualPaidCents: checked.actualPaidCents, payer: checked.payer, registeredAt: now };
  return repair;
}

// 换发票 / 补登发票：旧发票转入 invoiceHistory 留痕，不丢记录
export function registerInvoice(state, repairId, fields, now = new Date().toISOString()) {
  const repair = findRepair(state, repairId);
  if (repair.status !== "done") throw new LedgerError("未完工不能登记发票");
  const checked = checkInvoiceFields(state, repairId, fields);
  const balance = repairBalance(state, repairId);
  if (checked.actualPaidCents < balance.pendingCents + balance.receivedCents) {
    throw new LedgerError(
      `实付金额不能低于待收与已报销合计 ¥${formatCents(balance.pendingCents + balance.receivedCents)}，请先处理在途申请`
    );
  }
  if (repair.invoice) {
    repair.invoiceHistory.unshift({ ...repair.invoice, replacedAt: now, reason: (fields.reason || "").trim() });
  }
  repair.invoice = { no: checked.invoiceNo, actualPaidCents: checked.actualPaidCents, payer: checked.payer, registeredAt: now };
  return repair;
}

// ---------- 报销申请流水 ----------

// 提交报销：先占用申请金额（待收），占用后同笔维修可再申请的额度相应减少
export function submitRequest(state, repairId, fields, now = new Date().toISOString()) {
  const repair = findRepair(state, repairId);
  if (repair.status !== "done") throw new LedgerError("未完工不能申请报销");
  if (!repair.invoice) throw new LedgerError("尚未登记发票，无法申请报销");
  const amountCents = toCents(fields.amount);
  if (amountCents <= 0) throw new LedgerError("申请金额必须大于 0");
  const balance = repairBalance(state, repairId);
  if (amountCents > balance.availableCents) {
    throw new LedgerError(`可申请额度不足：实付 ¥${formatCents(balance.actualPaidCents)}，还可申请 ¥${formatCents(balance.availableCents)}`);
  }
  const request = {
    id: crypto.randomUUID(),
    repairId,
    amountCents,
    note: (fields.note || "").trim(),
    status: "pending",
    createdAt: now,
    receivedAt: null,
    returnedAt: null,
    returnReason: "",
    canceledAt: null
  };
  state.requests.unshift(request);
  return request;
}

// 到账：待收 → 已报销。同一笔维修已报销合计不能超过实付
export function markReceived(state, requestId, now = new Date().toISOString()) {
  const request = findRequest(state, requestId);
  if (request.status !== "pending") throw new LedgerError("只有待收中的申请才能确认到账");
  const balance = repairBalance(state, request.repairId);
  if (balance.receivedCents + request.amountCents > balance.actualPaidCents) {
    throw new LedgerError("到账后将超过实付金额，不能确认");
  }
  request.status = "received";
  request.receivedAt = now;
  return request;
}

// 退回：必须填原因，金额恢复为可再申请
export function markReturned(state, requestId, reason, now = new Date().toISOString()) {
  const request = findRequest(state, requestId);
  if (request.status !== "pending") throw new LedgerError("只有待收中的申请才能退回");
  const trimmed = (reason || "").trim();
  if (!trimmed) throw new LedgerError("退回必须填写原因");
  request.status = "returned";
  request.returnedAt = now;
  request.returnReason = trimmed;
  return request;
}

// 撤销：金额恢复为可再申请，申请记录保留
export function cancelRequest(state, requestId, now = new Date().toISOString()) {
  const request = findRequest(state, requestId);
  if (request.status !== "pending") throw new LedgerError("只有待收中的申请才能撤销");
  request.status = "canceled";
  request.canceledAt = now;
  return request;
}
