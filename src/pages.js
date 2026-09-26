// 页面：渲染与交互。账目规则在 rules.js，存档在 store.js，本文件不做业务校验。
import {
  LedgerError,
  REPAIR_STATUSES,
  REQUEST_STATUSES,
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
  repairRequests,
  totals,
  formatCents
} from "./rules.js";
import { loadLedger, saveLedger } from "./store.js";

const priorities = { high: "高优先级", medium: "中优先级", low: "低优先级" };

let state = loadLedger();
const app = document.querySelector("#app");
// 展开中的内联表单（页面状态，不入账）
const ui = { completeFor: null, invoiceFor: null, requestFor: null, returnFor: null };
let flash = null;

export function startApp() {
  render();
}

// 统一执行规则操作：成功则存档并提示，规则拒绝则原样展示原因
function act(action, okText) {
  try {
    action();
    saveLedger(state);
    flash = okText ? { kind: "ok", text: okText } : null;
    closeForms();
  } catch (err) {
    if (!(err instanceof LedgerError)) throw err;
    flash = { kind: "err", text: err.message };
  }
  render();
}

function closeForms() {
  ui.completeFor = ui.invoiceFor = ui.requestFor = ui.returnFor = null;
}

function render() {
  const t = totals(state);
  const repairs = filteredRepairs();
  app.innerHTML = `
    <main class="shell">
      <header class="header">
        <div>
          <p class="eyebrow">家庭维修 · 报销对账</p>
          <h1>维修报销账本</h1>
        </div>
        <section class="stats">
          <div class="stat"><span>未完工</span><strong>${t.unfinished}</strong></div>
          <div class="stat"><span>待收（占用中）</span><strong>¥${formatCents(t.pendingCents)}</strong></div>
          <div class="stat"><span>已报销</span><strong>¥${formatCents(t.receivedCents)}</strong></div>
          <div class="stat"><span>可再申请</span><strong>¥${formatCents(t.availableCents)}</strong></div>
        </section>
      </header>
      ${flash ? `<div class="flash ${flash.kind}">${escapeHtml(flash.text)}</div>` : ""}
      <section class="layout">
        <aside class="panel">
          <h2>新增维修事项</h2>
          <form class="form" id="repair-form">
            <label>位置<input name="location" required placeholder="例如卫生间"></label>
            <label>问题描述<textarea name="title" required placeholder="例如门锁松动"></textarea></label>
            <label>优先级<select name="priority">${priorityOptions("medium")}</select></label>
            <label>预计费用<input name="estimatedCost" type="number" min="0" step="1" value="0"></label>
            <label>照片链接<input name="photo" type="url" placeholder="可选，粘贴图片地址"></label>
            <label>备注<textarea name="note" placeholder="师傅电话、材料或注意事项"></textarea></label>
            <button class="primary" type="submit">保存事项</button>
          </form>
        </aside>
        <section>
          <div class="toolbar">${filterButtons()}</div>
          <div class="repairs">
            ${repairs.length ? repairs.map(renderRepair).join("") : `<div class="empty">当前状态下没有维修事项</div>`}
          </div>
        </section>
      </section>
      ${renderLedger()}
    </main>
  `;
  bindEvents();
}

function renderRepair(repair) {
  const done = repair.status === "done";
  const requests = repairRequests(state, repair.id);
  return `
    <article class="repair">
      <div class="photo">${repair.photo ? `<img src="${escapeHtml(repair.photo)}" alt="${escapeHtml(repair.location)}维修照片">` : "未添加照片"}</div>
      <div class="content">
        <div class="row">
          <h3>${escapeHtml(repair.location)}</h3>
          <span class="priority ${repair.priority}">${priorities[repair.priority] || escapeHtml(repair.priority)}</span>
          <span class="status ${repair.status}">${REPAIR_STATUSES[repair.status]}</span>
        </div>
        <p>${escapeHtml(repair.title)}</p>
        <div class="row">
          <span class="chip">预计 ¥${Number(repair.estimatedCost || 0)}</span>
          ${repair.note ? `<span class="chip">${escapeHtml(repair.note)}</span>` : ""}
        </div>
        ${done ? renderInvoiceLine(repair) : ""}
        ${done && repair.invoice ? renderBalances(repair) : ""}
        <div class="actions">${renderRepairActions(repair, done)}</div>
        ${ui.completeFor === repair.id ? renderCompleteForm(repair) : ""}
        ${ui.invoiceFor === repair.id ? renderInvoiceForm(repair) : ""}
        ${ui.requestFor === repair.id ? renderRequestForm(repair) : ""}
        ${requests.length ? `<div class="requests">${requests.map(renderRequest).join("")}</div>` : ""}
        ${renderInvoiceHistory(repair)}
      </div>
    </article>
  `;
}

function renderInvoiceLine(repair) {
  if (!repair.invoice) {
    return `<div class="invoice-line missing">已完工但尚未登记发票，补登发票号、实付金额和垫付人后才能报销</div>`;
  }
  const inv = repair.invoice;
  return `<div class="invoice-line">发票 ${escapeHtml(inv.no)} ｜ 实付 ¥${formatCents(inv.actualPaidCents)} ｜ 垫付人 ${escapeHtml(inv.payer)} ｜ 登记于 ${fmtTime(inv.registeredAt)}</div>`;
}

function renderBalances(repair) {
  const b = repairBalance(state, repair.id);
  return `
    <div class="balances">
      <div class="balance"><span>实付金额</span><strong>¥${formatCents(b.actualPaidCents)}</strong></div>
      <div class="balance"><span>待收（占用中）</span><strong>¥${formatCents(b.pendingCents)}</strong></div>
      <div class="balance"><span>已报销</span><strong>¥${formatCents(b.receivedCents)}</strong></div>
      <div class="balance"><span>可再申请</span><strong>¥${formatCents(b.availableCents)}</strong></div>
    </div>
  `;
}

function renderRepairActions(repair, done) {
  if (!done) {
    return `
      <select data-status="${repair.id}">${repairStatusOptions(repair.status)}</select>
      <button class="primary mini" type="button" data-toggle-complete="${repair.id}">完工登记</button>
      <button class="ghost mini" type="button" data-delete="${repair.id}">删除</button>
    `;
  }
  if (!repair.invoice) {
    return `<button class="primary mini" type="button" data-toggle-invoice="${repair.id}">补登发票</button>`;
  }
  return `
    <button class="primary mini" type="button" data-toggle-request="${repair.id}">申请报销</button>
    <button class="ghost mini" type="button" data-toggle-invoice="${repair.id}">换发票</button>
  `;
}

function renderCompleteForm(repair) {
  return `
    <form class="inline-form" data-complete="${repair.id}">
      <strong>完工登记：发票号、实付金额、垫付人缺一不可</strong>
      <div class="form-row">
        <label>发票号<input name="invoiceNo" required placeholder="例如 INV-2026-001"></label>
        <label>实付金额<input name="actualPaid" type="number" min="0.01" step="0.01" required placeholder="0.00"></label>
        <label>垫付人<input name="payer" required placeholder="谁先垫的钱"></label>
      </div>
      <div class="actions">
        <button class="primary mini" type="submit">确认完工并登记</button>
        <button class="ghost mini" type="button" data-close-form>取消</button>
      </div>
    </form>
  `;
}

function renderInvoiceForm(repair) {
  const inv = repair.invoice;
  return `
    <form class="inline-form" data-invoice="${repair.id}">
      <strong>${inv ? "换发票：旧发票会保留在换票记录里" : "补登发票"}</strong>
      <div class="form-row">
        <label>发票号<input name="invoiceNo" required value="${inv ? escapeHtml(inv.no) : ""}"></label>
        <label>实付金额<input name="actualPaid" type="number" min="0.01" step="0.01" required value="${inv ? (inv.actualPaidCents / 100).toFixed(2) : ""}"></label>
        <label>垫付人<input name="payer" required value="${inv ? escapeHtml(inv.payer) : ""}"></label>
      </div>
      <label>换票原因（可选）<input name="reason" placeholder="例如发票抬头开错，重新开具"></label>
      <div class="actions">
        <button class="primary mini" type="submit">保存发票</button>
        <button class="ghost mini" type="button" data-close-form>取消</button>
      </div>
    </form>
  `;
}

function renderRequestForm(repair) {
  const b = repairBalance(state, repair.id);
  return `
    <form class="inline-form" data-request="${repair.id}">
      <strong>申请报销：提交后金额先记为待收（占用），还可申请 ¥${formatCents(b.availableCents)}</strong>
      <div class="form-row">
        <label>申请金额<input name="amount" type="number" min="0.01" step="0.01" required placeholder="0.00"></label>
        <label>备注（可选）<input name="note" placeholder="例如走支付宝"></label>
      </div>
      <div class="actions">
        <button class="primary mini" type="submit">提交申请</button>
        <button class="ghost mini" type="button" data-close-form>取消</button>
      </div>
    </form>
  `;
}

function renderRequest(request) {
  const meta =
    request.status === "pending"
      ? `提交于 ${fmtTime(request.createdAt)}`
      : request.status === "received"
        ? `到账于 ${fmtTime(request.receivedAt)}`
        : request.status === "returned"
          ? `退回于 ${fmtTime(request.returnedAt)} ｜ 原因：${escapeHtml(request.returnReason)}`
          : `撤销于 ${fmtTime(request.canceledAt)}`;
  const actions =
    request.status === "pending"
      ? `
        <button class="primary mini" type="button" data-receive="${request.id}">到账</button>
        <button class="ghost mini" type="button" data-toggle-return="${request.id}">退回</button>
        <button class="ghost mini" type="button" data-cancel-request="${request.id}">撤销</button>
      `
      : "";
  return `
    <div class="request-row">
      <span class="amount">¥${formatCents(request.amountCents)}</span>
      <span class="q-status q-${request.status}">${REQUEST_STATUSES[request.status]}</span>
      <span class="request-meta">${meta}${request.note ? ` ｜ ${escapeHtml(request.note)}` : ""}</span>
      <span class="actions">${actions}</span>
      ${ui.returnFor === request.id ? renderReturnForm(request) : ""}
    </div>
  `;
}

function renderReturnForm(request) {
  return `
    <form class="inline-form" data-return="${request.id}">
      <label>退回原因（必填）<input name="reason" required placeholder="例如发票抬头与垫付人不符"></label>
      <div class="actions">
        <button class="primary mini" type="submit">确认退回</button>
        <button class="ghost mini" type="button" data-close-form>取消</button>
      </div>
    </form>
  `;
}

function renderInvoiceHistory(repair) {
  if (!repair.invoiceHistory || !repair.invoiceHistory.length) return "";
  const items = repair.invoiceHistory
    .map(
      (inv) =>
        `<li>旧发票 ${escapeHtml(inv.no)} ｜ 实付 ¥${formatCents(inv.actualPaidCents)} ｜ 垫付人 ${escapeHtml(inv.payer)} ｜ 更换于 ${fmtTime(inv.replacedAt)}${inv.reason ? ` ｜ 原因：${escapeHtml(inv.reason)}` : ""}</li>`
    )
    .join("");
  return `<details class="history"><summary>换票记录（${repair.invoiceHistory.length}）</summary><ul>${items}</ul></details>`;
}

// 报销流水：所有申请（含已退回、已撤销）都在，旧账照常可查
function renderLedger() {
  const rows = [...state.requests].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  const body = rows
    .map((request) => {
      const repair = state.repairs.find((item) => item.id === request.repairId);
      const later =
        request.status === "received"
          ? `到账 ${fmtTime(request.receivedAt)}`
          : request.status === "returned"
            ? `退回 ${fmtTime(request.returnedAt)}：${escapeHtml(request.returnReason)}`
            : request.status === "canceled"
              ? `撤销 ${fmtTime(request.canceledAt)}`
              : "待收中";
      return `
        <tr>
          <td>${fmtTime(request.createdAt)}</td>
          <td>${repair ? `${escapeHtml(repair.location)} · ${escapeHtml(repair.title)}` : "（维修已删除）"}</td>
          <td>${repair && repair.invoice ? escapeHtml(repair.invoice.no) : "—"}</td>
          <td>¥${formatCents(request.amountCents)}</td>
          <td><span class="q-status q-${request.status}">${REQUEST_STATUSES[request.status]}</span></td>
          <td>${later}${request.note ? ` ｜ ${escapeHtml(request.note)}` : ""}</td>
        </tr>
      `;
    })
    .join("");
  return `
    <section class="ledger panel">
      <h2>报销流水</h2>
      ${
        rows.length
          ? `<table>
              <thead><tr><th>提交时间</th><th>维修</th><th>发票号</th><th>金额</th><th>状态</th><th>后续处理</th></tr></thead>
              <tbody>${body}</tbody>
            </table>`
          : `<div class="empty">暂无报销申请</div>`
      }
    </section>
  `;
}

function bindEvents() {
  document.querySelector("#repair-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.target));
    act(() => addRepair(state, data), "已保存维修事项");
  });

  document.querySelectorAll("[data-filter]").forEach((button) => {
    button.addEventListener("click", () => {
      state.filter = button.dataset.filter;
      saveLedger(state);
      render();
    });
  });

  document.querySelectorAll("[data-status]").forEach((select) => {
    select.addEventListener("change", () => {
      act(() => setRepairStatus(state, select.dataset.status, select.value));
    });
  });

  document.querySelectorAll("[data-delete]").forEach((button) => {
    button.addEventListener("click", () => {
      act(() => deleteRepair(state, button.dataset.delete), "已删除");
    });
  });

  document.querySelectorAll("[data-toggle-complete]").forEach((button) => {
    button.addEventListener("click", () => {
      closeForms();
      ui.completeFor = button.dataset.toggleComplete;
      render();
    });
  });

  document.querySelectorAll("[data-toggle-invoice]").forEach((button) => {
    button.addEventListener("click", () => {
      closeForms();
      ui.invoiceFor = button.dataset.toggleInvoice;
      render();
    });
  });

  document.querySelectorAll("[data-toggle-request]").forEach((button) => {
    button.addEventListener("click", () => {
      closeForms();
      ui.requestFor = button.dataset.toggleRequest;
      render();
    });
  });

  document.querySelectorAll("[data-toggle-return]").forEach((button) => {
    button.addEventListener("click", () => {
      closeForms();
      ui.returnFor = button.dataset.toggleReturn;
      render();
    });
  });

  document.querySelectorAll("[data-close-form]").forEach((button) => {
    button.addEventListener("click", () => {
      closeForms();
      render();
    });
  });

  document.querySelectorAll("form[data-complete]").forEach((form) => {
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const data = Object.fromEntries(new FormData(form));
      act(() => completeRepair(state, form.dataset.complete, data), "已完工并登记发票");
    });
  });

  document.querySelectorAll("form[data-invoice]").forEach((form) => {
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const data = Object.fromEntries(new FormData(form));
      act(() => registerInvoice(state, form.dataset.invoice, data), "发票已保存，旧记录已保留");
    });
  });

  document.querySelectorAll("form[data-request]").forEach((form) => {
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const data = Object.fromEntries(new FormData(form));
      act(() => submitRequest(state, form.dataset.request, data), "已提交申请，金额记为待收");
    });
  });

  document.querySelectorAll("[data-receive]").forEach((button) => {
    button.addEventListener("click", () => {
      act(() => markReceived(state, button.dataset.receive), "已到账，转为已报销");
    });
  });

  document.querySelectorAll("form[data-return]").forEach((form) => {
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const data = Object.fromEntries(new FormData(form));
      act(() => markReturned(state, form.dataset.return, data.reason), "已退回，额度恢复可再申请");
    });
  });

  document.querySelectorAll("[data-cancel-request]").forEach((button) => {
    button.addEventListener("click", () => {
      act(() => cancelRequest(state, button.dataset.cancelRequest), "申请已撤销，记录保留");
    });
  });
}

function filteredRepairs() {
  if (state.filter === "all") return state.repairs;
  return state.repairs.filter((repair) => repair.status === state.filter);
}

function filterButtons() {
  const filters = { all: "全部", ...REPAIR_STATUSES };
  return Object.entries(filters)
    .map(([value, label]) => `<button class="seg ${state.filter === value ? "active" : ""}" data-filter="${value}">${label}</button>`)
    .join("");
}

function repairStatusOptions(selected) {
  return ["todo", "doing"].map((value) => `<option value="${value}" ${selected === value ? "selected" : ""}>${REPAIR_STATUSES[value]}</option>`).join("");
}

function priorityOptions(selected) {
  return Object.entries(priorities)
    .map(([value, label]) => `<option value="${value}" ${selected === value ? "selected" : ""}>${label}</option>`)
    .join("");
}

function fmtTime(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[char]);
}
