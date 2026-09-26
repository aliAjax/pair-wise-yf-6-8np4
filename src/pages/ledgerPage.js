// 报销流水页：全部报销记录与发票档案，旧记录（退回、撤销、换票）都在此留痕。

import { CLAIM_STATUS, INVOICE_STATUS, findRepair, ledgerSummary } from "../rules.js";
import { escapeHtml, fmtMoney, fmtTime, claimBadge, claimDetailParts, claimActionsHtml, bindShared } from "./shared.js";

const CLAIM_FILTERS = { all: "全部", ...CLAIM_STATUS };

export function renderLedgerPage(container, state, ui, actions) {
  const summary = ledgerSummary(state);
  const claims = state.claims
    .slice()
    .sort((a, b) => b.submittedAt.localeCompare(a.submittedAt))
    .filter((claim) => ui.ledgerFilter === "all" || claim.status === ui.ledgerFilter);
  const invoices = state.invoices.slice().sort((a, b) => b.registeredAt.localeCompare(a.registeredAt));

  container.innerHTML = `
    <section class="ledger">
      <div class="stats ledger-stats">
        <div class="stat"><span>已完工维修</span><strong>${summary.doneCount}</strong></div>
        <div class="stat"><span>实付合计</span><strong>${fmtMoney(summary.paid)}</strong></div>
        <div class="stat"><span>申请中（占用）</span><strong>${fmtMoney(summary.pending)}</strong></div>
        <div class="stat"><span>已报销</span><strong>${fmtMoney(summary.reimbursed)}</strong></div>
        <div class="stat"><span>可报销余额</span><strong>${fmtMoney(summary.available)}</strong></div>
      </div>

      <section class="panel">
        <div class="panel-head">
          <h2>报销流水</h2>
          <div class="toolbar">
            ${Object.entries(CLAIM_FILTERS).map(([value, label]) => `<button class="seg ${ui.ledgerFilter === value ? "active" : ""}" data-ledger-filter="${value}">${label}</button>`).join("")}
          </div>
        </div>
        ${claims.length ? claimsTableHtml(state, ui, claims) : `<div class="empty">暂无报销记录</div>`}
      </section>

      <section class="panel">
        <div class="panel-head"><h2>发票档案</h2></div>
        <p class="hint">换发票不会删除旧记录，历史发票在此留档备查。</p>
        ${invoices.length ? invoicesTableHtml(state, invoices) : `<div class="empty">暂无发票记录</div>`}
      </section>
    </section>
  `;

  container.querySelectorAll("[data-ledger-filter]").forEach((button) => {
    button.addEventListener("click", () => actions.setLedgerFilter(button.dataset.ledgerFilter));
  });
  bindShared(container, actions);
}

function repairLabel(state, repairId) {
  const repair = findRepair(state, repairId);
  return repair ? `${escapeHtml(repair.location)}｜${escapeHtml(repair.title)}` : "（维修已删除）";
}

function claimsTableHtml(state, ui, claims) {
  return `
    <div class="table-wrap">
      <table>
        <thead>
          <tr><th>提交时间</th><th>维修</th><th>发票号</th><th>金额</th><th>状态</th><th>说明</th><th>操作</th></tr>
        </thead>
        <tbody>
          ${claims.map((claim) => `
            <tr>
              <td class="nowrap">${fmtTime(claim.submittedAt)}</td>
              <td>${repairLabel(state, claim.repairId)}</td>
              <td class="nowrap">${escapeHtml(claim.invoiceNo)}</td>
              <td class="amount-cell">${fmtMoney(claim.amount)}</td>
              <td>${claimBadge(claim.status)}</td>
              <td>${claimDetailParts(claim).join("<br>") || "—"}</td>
              <td>${claimActionsHtml(claim, ui)}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function invoicesTableHtml(state, invoices) {
  return `
    <div class="table-wrap">
      <table>
        <thead>
          <tr><th>发票号</th><th>维修</th><th>实付金额</th><th>垫付人</th><th>状态</th><th>登记时间</th><th>更换说明</th></tr>
        </thead>
        <tbody>
          ${invoices.map((inv) => `
            <tr>
              <td class="nowrap">${escapeHtml(inv.invoiceNo)}</td>
              <td>${repairLabel(state, inv.repairId)}</td>
              <td class="amount-cell">${fmtMoney(inv.paidAmount)}</td>
              <td>${escapeHtml(inv.payer)}</td>
              <td><span class="claim-status ${inv.status}">${INVOICE_STATUS[inv.status]}</span></td>
              <td class="nowrap">${fmtTime(inv.registeredAt)}</td>
              <td>${inv.status === "replaced" ? `${fmtTime(inv.replacedAt)} 更换：${escapeHtml(inv.replaceReason)}` : "—"}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;
}
