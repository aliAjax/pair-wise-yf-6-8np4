// 入口：把存档（store）、账目规则（rules）与页面（pages）装配起来。

import "./styles.css";
import { loadState, saveState } from "./store.js";
import * as Rules from "./rules.js";
import { renderRepairsPage } from "./pages/repairsPage.js";
import { renderLedgerPage } from "./pages/ledgerPage.js";
import { escapeHtml, fmtMoney } from "./pages/shared.js";

let state = loadState();
let flash = null; // 渲染后展示一次的成功提示
const ui = { complete: null, claim: null, invoice: null, reject: null, ledgerFilter: "all" };
const app = document.querySelector("#app");

const actions = {
  switchTab(tab) {
    state.tab = tab;
    saveState(state);
    flash = null;
    ui.complete = ui.claim = ui.invoice = ui.reject = null;
    render();
  },
  setFilter(filter) {
    state.filter = filter;
    saveState(state);
    render();
  },
  setLedgerFilter(filter) {
    ui.ledgerFilter = filter;
    render();
  },
  toggle(form, id) {
    ui[form] = ui[form] === id ? null : id;
    render();
  },

  addRepair(data) {
    commit(Rules.addRepair(state, data), "维修事项已保存");
  },
  setRepairStatus(id, status) {
    commit(Rules.setRepairStatus(state, id, status));
  },
  deleteRepair(id) {
    if (!window.confirm("确定删除该维修事项吗？")) return;
    commit(Rules.removeRepair(state, id), "已删除");
  },
  completeRepair(id, data) {
    const result = Rules.completeRepair(state, id, data);
    if (!result.error) ui.complete = null;
    commit(result, "完工登记成功，发票已入账");
  },
  registerInvoice(id, data) {
    const result = Rules.registerInvoice(state, id, data);
    if (!result.error) ui.complete = null;
    commit(result, "发票已补登");
  },
  changeInvoice(id, data) {
    const result = Rules.changeInvoice(state, id, data);
    if (!result.error) ui.invoice = null;
    commit(result, "已换发票，旧记录已保留");
  },
  submitClaim(id, data) {
    const result = Rules.submitClaim(state, id, data);
    if (!result.error) ui.claim = null;
    commit(result, "报销申请已提交，金额已占用");
  },
  settleClaim(id) {
    if (!window.confirm("确认该笔报销已到账？")) return;
    commit(Rules.settleClaim(state, id), "已转为已报销");
  },
  rejectClaim(id, reason) {
    const result = Rules.rejectClaim(state, id, reason);
    if (!result.error) ui.reject = null;
    commit(result, "已退回，金额恢复可用");
  },
  cancelClaim(id) {
    if (!window.confirm("确定撤销该申请吗？记录会保留为「已撤销」。")) return;
    commit(Rules.cancelClaim(state, id), "已撤销，记录保留在流水中");
  }
};

// 规则校验失败时不重新渲染（保住表单输入），只把错误显示到提示条
function commit(result, okText) {
  if (result.error) {
    showFlash("error", result.error);
    return;
  }
  state = result.state;
  saveState(state);
  flash = okText ? { type: "ok", text: okText } : null;
  render();
}

function showFlash(type, text) {
  const el = document.querySelector("#flash");
  if (!el) return;
  el.hidden = !text;
  el.className = `flash ${type}`;
  el.textContent = text || "";
}

function render() {
  const unfinished = state.repairs.filter((repair) => repair.status !== "done");
  const doing = state.repairs.filter((repair) => repair.status === "doing").length;
  const totalCost = unfinished.reduce((total, repair) => total + Number(repair.cost || 0), 0);
  const currentFlash = flash;
  flash = null;

  app.innerHTML = `
    <main class="shell">
      <header class="header">
        <div>
          <p class="eyebrow">本地家庭维护台</p>
          <h1>家庭维修账目</h1>
        </div>
        <section class="stats">
          <div class="stat"><span>未完成</span><strong>${unfinished.length}</strong></div>
          <div class="stat"><span>处理中</span><strong>${doing}</strong></div>
          <div class="stat"><span>预计费用</span><strong>${fmtMoney(totalCost)}</strong></div>
        </section>
      </header>
      <nav class="tabs">
        <button class="tab ${state.tab === "repairs" ? "active" : ""}" data-tab="repairs">维修事项</button>
        <button class="tab ${state.tab === "ledger" ? "active" : ""}" data-tab="ledger">报销流水</button>
      </nav>
      <div id="flash" class="flash ${currentFlash ? currentFlash.type : ""}" ${currentFlash ? "" : "hidden"}>${currentFlash ? escapeHtml(currentFlash.text) : ""}</div>
      <div id="page"></div>
    </main>
  `;

  document.querySelectorAll("[data-tab]").forEach((button) => {
    button.addEventListener("click", () => actions.switchTab(button.dataset.tab));
  });

  const page = document.querySelector("#page");
  if (state.tab === "ledger") renderLedgerPage(page, state, ui, actions);
  else renderRepairsPage(page, state, ui, actions);
}

render();
