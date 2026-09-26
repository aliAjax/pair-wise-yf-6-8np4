// 页面共用工具：转义、格式化、报销记录的操作按钮与事件绑定。

import { CLAIM_STATUS } from "../rules.js";

export function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[char]);
}

export function fmtMoney(value) {
  const num = Number(value || 0);
  const digits = Number.isInteger(num) ? 0 : 2;
  return `¥${num.toLocaleString("zh-CN", { minimumFractionDigits: digits, maximumFractionDigits: 2 })}`;
}

export function fmtTime(iso) {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function claimBadge(status) {
  return `<span class="claim-status ${status}">${CLAIM_STATUS[status] || status}</span>`;
}

// 报销记录的说明文字：备注 + 各状态的后续信息（退回原因、撤销原因、到账时间）
export function claimDetailParts(claim) {
  const parts = [];
  if (claim.note) parts.push(escapeHtml(claim.note));
  if (claim.status === "reimbursed") parts.push(`到账时间 ${fmtTime(claim.settledAt)}`);
  if (claim.status === "rejected") parts.push(`退回原因：${escapeHtml(claim.rejectReason)}`);
  if (claim.status === "canceled") parts.push(`撤销原因：${escapeHtml(claim.cancelReason || "主动撤销")}`);
  return parts;
}

export function claimDetailHtml(claim) {
  const parts = claimDetailParts(claim);
  return parts.length ? `<div class="claim-sub">${parts.join("；")}</div>` : "";
}

// 申请中的记录才有操作：到账 / 退回（展开填原因）/ 撤销
export function claimActionsHtml(claim, ui) {
  if (claim.status !== "pending") return "";
  if (ui.reject === claim.id) {
    return `
      <form class="form inline-form" data-form="reject" data-id="${claim.id}">
        <label>退回原因<input name="reason" required placeholder="必填，例如 发票抬头有误"></label>
        <div class="actions">
          <button class="primary" type="submit">确认退回</button>
          <button class="ghost" type="button" data-close-form="reject">取消</button>
        </div>
      </form>
    `;
  }
  return `
    <div class="actions">
      <button class="primary sm" data-settle="${claim.id}">到账</button>
      <button class="ghost" data-open-reject="${claim.id}">退回</button>
      <button class="ghost" data-cancel-claim="${claim.id}">撤销</button>
    </div>
  `;
}

// 两个页面共用的报销操作事件
export function bindShared(container, actions) {
  container.querySelectorAll("[data-close-form]").forEach((button) => {
    button.addEventListener("click", () => actions.toggle(button.dataset.closeForm, null));
  });
  container.querySelectorAll("[data-open-reject]").forEach((button) => {
    button.addEventListener("click", () => actions.toggle("reject", button.dataset.openReject));
  });
  container.querySelectorAll("[data-settle]").forEach((button) => {
    button.addEventListener("click", () => actions.settleClaim(button.dataset.settle));
  });
  container.querySelectorAll("[data-cancel-claim]").forEach((button) => {
    button.addEventListener("click", () => actions.cancelClaim(button.dataset.cancelClaim));
  });
  container.querySelectorAll('form[data-form="reject"]').forEach((form) => {
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const data = Object.fromEntries(new FormData(form));
      actions.rejectClaim(form.dataset.id, data.reason);
    });
  });
}
