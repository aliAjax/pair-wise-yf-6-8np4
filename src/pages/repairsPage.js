// 维修事项页：新增/筛选/状态调整 + 完工登记、发票与报销操作。

import { REPAIR_STATUS, REPAIR_PRIORITY, accountOf, claimsOf, hasLedger } from "../rules.js";
import { escapeHtml, fmtMoney, fmtTime, claimBadge, claimDetailHtml, claimActionsHtml, bindShared } from "./shared.js";

const FILTERS = { all: "全部", ...REPAIR_STATUS };

export function renderRepairsPage(container, state, ui, actions) {
  const repairs = state.filter === "all" ? state.repairs : state.repairs.filter((repair) => repair.status === state.filter);

  container.innerHTML = `
    <section class="layout">
      <aside class="panel">
        <h2>新增维修事项</h2>
        <form class="form" id="repair-form">
          <label>位置<input name="location" required placeholder="例如卫生间"></label>
          <label>问题描述<textarea name="title" required placeholder="例如门锁松动"></textarea></label>
          <label>优先级<select name="priority">${priorityOptions("medium")}</select></label>
          <label>预计费用<input name="cost" type="number" min="0" step="0.01" value="0"></label>
          <label>处理状态<select name="status">${statusOptions("todo")}</select></label>
          <label>照片链接<input name="photo" type="url" placeholder="可选，粘贴图片地址"></label>
          <label>备注<textarea name="note" placeholder="师傅电话、材料或注意事项"></textarea></label>
          <button class="primary" type="submit">保存事项</button>
        </form>
        <p class="hint">完工后通过卡片上的「完工登记」录入发票号、实付金额与垫付人，之后才能申请报销。</p>
      </aside>

      <section>
        <div class="toolbar">
          ${Object.entries(FILTERS).map(([value, label]) => `<button class="seg ${state.filter === value ? "active" : ""}" data-filter="${value}">${label}</button>`).join("")}
        </div>
        <div class="repairs">
          ${repairs.length ? repairs.map((repair) => repairCard(state, ui, repair)).join("") : `<div class="empty">当前状态下没有维修事项</div>`}
        </div>
      </section>
    </section>
  `;

  bind(container, actions);
}

function repairCard(state, ui, repair) {
  const done = repair.status === "done";
  const locked = hasLedger(state, repair.id);
  return `
    <article class="repair">
      <div class="photo">${repair.photo ? `<img src="${escapeHtml(repair.photo)}" alt="${escapeHtml(repair.location)}维修照片">` : "未添加照片"}</div>
      <div class="content">
        <div class="row">
          <h3>${escapeHtml(repair.location)}</h3>
          <span class="priority ${repair.priority}">${REPAIR_PRIORITY[repair.priority] || repair.priority}</span>
          <span class="status ${repair.status}">${REPAIR_STATUS[repair.status]}</span>
        </div>
        <p>${escapeHtml(repair.title)}</p>
        <div class="row">
          <span class="chip">预计 ${fmtMoney(repair.cost)}</span>
          <span class="chip">${escapeHtml(repair.note || "暂无备注")}</span>
          ${done && repair.completedAt ? `<span class="chip">完工于 ${fmtTime(repair.completedAt)}</span>` : ""}
        </div>
        ${done ? doneSection(state, ui, repair) : todoSection(ui, repair)}
        <div class="actions">
          ${!done ? `<select data-status="${repair.id}">${statusOptions(repair.status)}</select>` : ""}
          <button class="ghost" data-delete="${repair.id}" ${locked ? 'disabled title="已有发票或报销流水，不能删除"' : ""}>删除</button>
        </div>
      </div>
    </article>
  `;
}

// 未完工：只能调整状态或做完工登记，不能报销
function todoSection(ui, repair) {
  if (ui.complete === repair.id) return `<div class="ledger-box">${invoiceFormHtml(repair, "complete")}</div>`;
  return `
    <div class="ledger-box">
      <p class="hint">完工后登记发票，才能申请报销。</p>
      <div class="actions"><button class="primary sm" data-open-complete="${repair.id}">完工登记</button></div>
    </div>
  `;
}

function doneSection(state, ui, repair) {
  const acc = accountOf(state, repair.id);

  // 旧账：已完工但没登记发票，需先补登
  if (!acc.invoice) {
    return `
      <div class="ledger-box">
        <p class="hint warn">该维修已完工但尚未登记发票（旧账），补登后才能申请报销。</p>
        ${ui.complete === repair.id ? invoiceFormHtml(repair, "register") : `<div class="actions"><button class="primary sm" data-open-complete="${repair.id}">补登发票</button></div>`}
      </div>
    `;
  }

  return `
    <div class="ledger-box">
      <div class="row">
        <span class="chip strong">发票 ${escapeHtml(acc.invoice.invoiceNo)}</span>
        <span class="chip">实付 ${fmtMoney(acc.paid)}</span>
        <span class="chip">垫付人 ${escapeHtml(acc.invoice.payer)}</span>
      </div>
      <div class="row">
        <span class="chip pending">申请中 ${fmtMoney(acc.pending)}</span>
        <span class="chip reimbursed">已报销 ${fmtMoney(acc.reimbursed)}</span>
        <span class="chip available">可报销 ${fmtMoney(acc.available)}</span>
      </div>
      <div class="actions">
        ${acc.available > 0 ? `<button class="primary sm" data-open-claim="${repair.id}">申请报销</button>` : `<span class="chip">报销额度已用完</span>`}
        <button class="ghost" data-open-invoice="${repair.id}">换发票</button>
      </div>
      ${ui.claim === repair.id ? claimFormHtml(repair, acc) : ""}
      ${ui.invoice === repair.id ? changeFormHtml(repair, acc) : ""}
      ${claimListHtml(state, ui, repair.id)}
    </div>
  `;
}

// 完工登记 / 补登发票共用：发票号、实付金额、垫付人
function invoiceFormHtml(repair, mode) {
  const isComplete = mode === "complete";
  return `
    <form class="form inline-form" data-form="${isComplete ? "complete" : "register"}" data-id="${repair.id}">
      <div class="grid-3">
        <label>发票号<input name="invoiceNo" required placeholder="例如 INV-2026-0001"></label>
        <label>实付金额<input name="paidAmount" type="number" min="0.01" step="0.01" required placeholder="0.00"></label>
        <label>垫付人<input name="payer" required placeholder="例如 妈妈"></label>
      </div>
      <div class="actions">
        <button class="primary" type="submit">${isComplete ? "完工并登记发票" : "保存发票"}</button>
        <button class="ghost" type="button" data-close-form="complete">取消</button>
      </div>
    </form>
  `;
}

function claimFormHtml(repair, acc) {
  return `
    <form class="form inline-form" data-form="claim" data-id="${repair.id}">
      <div class="grid-2">
        <label>申请金额<input name="amount" type="number" min="0.01" max="${acc.available}" step="0.01" required placeholder="最多可申请 ${acc.available}"></label>
        <label>备注<input name="note" placeholder="可选，例如 材料费"></label>
      </div>
      <p class="hint">提交后金额先记为「申请中」并占用额度，到账后转为「已报销」。</p>
      <div class="actions">
        <button class="primary" type="submit">提交申请</button>
        <button class="ghost" type="button" data-close-form="claim">取消</button>
      </div>
    </form>
  `;
}

function changeFormHtml(repair, acc) {
  return `
    <form class="form inline-form" data-form="invoice" data-id="${repair.id}">
      <div class="grid-3">
        <label>新发票号<input name="invoiceNo" required value="${escapeHtml(acc.invoice.invoiceNo)}"></label>
        <label>实付金额<input name="paidAmount" type="number" min="0.01" step="0.01" required value="${acc.invoice.paidAmount}"></label>
        <label>垫付人<input name="payer" required value="${escapeHtml(acc.invoice.payer)}"></label>
      </div>
      <label>换票原因<input name="reason" required placeholder="必填，例如 原发票抬头有误，作废重开"></label>
      <p class="hint">旧发票会保留在「报销流水 · 发票档案」；实付不能低于已占用与已报销合计。</p>
      <div class="actions">
        <button class="primary" type="submit">确认换票</button>
        <button class="ghost" type="button" data-close-form="invoice">取消</button>
      </div>
    </form>
  `;
}

function claimListHtml(state, ui, repairId) {
  const claims = claimsOf(state, repairId).slice().sort((a, b) => b.submittedAt.localeCompare(a.submittedAt));
  if (!claims.length) return "";
  return `
    <ul class="claims">
      ${claims.map((claim) => `
        <li class="claim">
          <div class="claim-main">
            <strong>${fmtMoney(claim.amount)}</strong>
            ${claimBadge(claim.status)}
            <span class="time">${fmtTime(claim.submittedAt)} 提交</span>
          </div>
          ${claimDetailHtml(claim)}
          ${claimActionsHtml(claim, ui)}
        </li>
      `).join("")}
    </ul>
  `;
}

function statusOptions(selected) {
  return ["todo", "doing"]
    .map((value) => `<option value="${value}" ${selected === value ? "selected" : ""}>${REPAIR_STATUS[value]}</option>`)
    .join("");
}

function priorityOptions(selected) {
  return Object.entries(REPAIR_PRIORITY)
    .map(([value, label]) => `<option value="${value}" ${selected === value ? "selected" : ""}>${label}</option>`)
    .join("");
}

function bind(container, actions) {
  container.querySelector("#repair-form").addEventListener("submit", (event) => {
    event.preventDefault();
    actions.addRepair(Object.fromEntries(new FormData(event.target)));
  });
  container.querySelectorAll("[data-filter]").forEach((button) => {
    button.addEventListener("click", () => actions.setFilter(button.dataset.filter));
  });
  container.querySelectorAll("[data-status]").forEach((select) => {
    select.addEventListener("change", () => actions.setRepairStatus(select.dataset.status, select.value));
  });
  container.querySelectorAll("[data-delete]").forEach((button) => {
    button.addEventListener("click", () => actions.deleteRepair(button.dataset.delete));
  });
  container.querySelectorAll("[data-open-complete]").forEach((button) => {
    button.addEventListener("click", () => actions.toggle("complete", button.dataset.openComplete));
  });
  container.querySelectorAll("[data-open-claim]").forEach((button) => {
    button.addEventListener("click", () => actions.toggle("claim", button.dataset.openClaim));
  });
  container.querySelectorAll("[data-open-invoice]").forEach((button) => {
    button.addEventListener("click", () => actions.toggle("invoice", button.dataset.openInvoice));
  });
  container.querySelectorAll('form[data-form="complete"], form[data-form="register"], form[data-form="claim"], form[data-form="invoice"]').forEach((form) => {
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const data = Object.fromEntries(new FormData(form));
      const id = form.dataset.id;
      const kind = form.dataset.form;
      if (kind === "complete") actions.completeRepair(id, data);
      else if (kind === "register") actions.registerInvoice(id, data);
      else if (kind === "claim") actions.submitClaim(id, data);
      else actions.changeInvoice(id, data);
    });
  });
  bindShared(container, actions);
}
