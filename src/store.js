// 存档：localStorage 读写、数据形状校正、旧版本数据迁移。
// 只负责“怎么存”，不含账目规则（见 rules.js）。

const STORAGE_KEY = "zfl-14-ledger";
const LEGACY_KEY = "zfl-14-repairs";
export const SCHEMA_VERSION = 2;

export function emptyLedger() {
  return { version: SCHEMA_VERSION, filter: "all", repairs: [], requests: [] };
}

// 旧版（v1）只有维修事项，没有发票与报销流水。
// 迁移时事项原样保留、账目字段留空，已完工的旧账补登发票后即可正常报销。
export function migrateLegacy(old) {
  const base = emptyLedger();
  if (!old || typeof old !== "object") return base;
  base.filter = typeof old.filter === "string" ? old.filter : "all";
  base.repairs = (Array.isArray(old.repairs) ? old.repairs : []).map((item) => ({
    id: item.id || crypto.randomUUID(),
    location: item.location || "",
    title: item.title || "",
    priority: item.priority || "medium",
    estimatedCost: Number(item.cost ?? item.estimatedCost ?? 0) || 0,
    status: item.status || "todo",
    photo: item.photo || "",
    note: item.note || "",
    completedAt: null,
    invoice: null,
    invoiceHistory: []
  }));
  return base;
}

// 校正读入数据的形状，缺字段补默认值，避免手改存档后页面崩掉
export function normalize(raw) {
  const base = emptyLedger();
  if (!raw || typeof raw !== "object") return base;
  base.filter = typeof raw.filter === "string" ? raw.filter : "all";
  if (Array.isArray(raw.repairs)) {
    base.repairs = raw.repairs.map((item) => ({
      id: item.id || crypto.randomUUID(),
      location: item.location || "",
      title: item.title || "",
      priority: item.priority || "medium",
      estimatedCost: Number(item.estimatedCost ?? 0) || 0,
      status: item.status || "todo",
      photo: item.photo || "",
      note: item.note || "",
      completedAt: item.completedAt ?? null,
      invoice: item.invoice ?? null,
      invoiceHistory: Array.isArray(item.invoiceHistory) ? item.invoiceHistory : []
    }));
  }
  if (Array.isArray(raw.requests)) {
    base.requests = raw.requests.map((item) => ({
      id: item.id || crypto.randomUUID(),
      repairId: item.repairId || "",
      amountCents: Number(item.amountCents) || 0,
      note: item.note || "",
      status: item.status || "pending",
      createdAt: item.createdAt ?? null,
      receivedAt: item.receivedAt ?? null,
      returnedAt: item.returnedAt ?? null,
      returnReason: item.returnReason || "",
      canceledAt: item.canceledAt ?? null
    }));
  }
  return base;
}

export function loadLedger(storage = localStorage) {
  const saved = storage.getItem(STORAGE_KEY);
  if (saved) {
    try {
      return normalize(JSON.parse(saved));
    } catch {
      return emptyLedger();
    }
  }
  const legacy = storage.getItem(LEGACY_KEY);
  if (legacy) {
    try {
      const migrated = migrateLegacy(JSON.parse(legacy));
      saveLedger(migrated, storage);
      return migrated;
    } catch {
      // 旧数据损坏时按空账本启动，不阻塞使用
    }
  }
  return emptyLedger();
}

export function saveLedger(state, storage = localStorage) {
  storage.setItem(STORAGE_KEY, JSON.stringify(state));
}
