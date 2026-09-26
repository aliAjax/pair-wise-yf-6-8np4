// 存档层：localStorage 读写与旧数据迁移，不含任何账目规则。

const STORAGE_KEY = "zfl-14-repairs";

export function loadState() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) return migrate(JSON.parse(saved));
  } catch (error) {
    console.warn("读取存档失败，使用初始数据", error);
  }
  return seedState();
}

export function saveState(state) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

// 旧版本只有 repairs，这里补齐账目字段，保证旧账照常查看
function migrate(state) {
  const repairs = Array.isArray(state.repairs) ? state.repairs : [];
  return {
    tab: state.tab === "ledger" ? "ledger" : "repairs",
    filter: state.filter || "all",
    repairs: repairs.map((repair) => ({
      photo: "",
      note: "",
      cost: 0,
      priority: "medium",
      createdAt: null,
      completedAt: null,
      ...repair
    })),
    invoices: Array.isArray(state.invoices) ? state.invoices : [],
    claims: Array.isArray(state.claims) ? state.claims : []
  };
}

// 首次使用的示例数据：一笔待处理、一笔已完工且有完整报销流水
function seedState() {
  const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString();
  return {
    tab: "repairs",
    filter: "all",
    repairs: [
      {
        id: "seed-kitchen",
        location: "厨房",
        title: "水槽下方渗水",
        priority: "high",
        cost: 260,
        status: "todo",
        photo: "",
        note: "先检查软管接口",
        createdAt: daysAgo(2),
        completedAt: null
      },
      {
        id: "seed-bathroom",
        location: "卫生间",
        title: "花洒软管老化更换",
        priority: "medium",
        cost: 400,
        status: "done",
        photo: "",
        note: "师傅建议换不锈钢软管",
        createdAt: daysAgo(9),
        completedAt: daysAgo(7)
      }
    ],
    invoices: [
      {
        id: "seed-inv-old",
        repairId: "seed-bathroom",
        invoiceNo: "INV-2026-0300",
        paidAmount: 380,
        payer: "妈妈",
        status: "replaced",
        registeredAt: daysAgo(7),
        replacedAt: daysAgo(6),
        replaceReason: "原发票税号开具有误，作废重开"
      },
      {
        id: "seed-inv-current",
        repairId: "seed-bathroom",
        invoiceNo: "INV-2026-0315",
        paidAmount: 380,
        payer: "妈妈",
        status: "active",
        registeredAt: daysAgo(6),
        replacedAt: null,
        replaceReason: ""
      }
    ],
    claims: [
      {
        id: "seed-claim-1",
        repairId: "seed-bathroom",
        invoiceId: "seed-inv-current",
        invoiceNo: "INV-2026-0315",
        amount: 180,
        note: "材料费",
        status: "reimbursed",
        submittedAt: daysAgo(6),
        settledAt: daysAgo(5),
        rejectedAt: null,
        canceledAt: null,
        rejectReason: "",
        cancelReason: ""
      },
      {
        id: "seed-claim-2",
        repairId: "seed-bathroom",
        invoiceId: "seed-inv-current",
        invoiceNo: "INV-2026-0315",
        amount: 50,
        note: "上门费",
        status: "rejected",
        submittedAt: daysAgo(6),
        settledAt: null,
        rejectedAt: daysAgo(6),
        canceledAt: null,
        rejectReason: "发票抬头有误，需重开后重新申请",
        cancelReason: ""
      },
      {
        id: "seed-claim-3",
        repairId: "seed-bathroom",
        invoiceId: "seed-inv-current",
        invoiceNo: "INV-2026-0315",
        amount: 100,
        note: "人工费尾款",
        status: "pending",
        submittedAt: daysAgo(1),
        settledAt: null,
        rejectedAt: null,
        canceledAt: null,
        rejectReason: "",
        cancelReason: ""
      }
    ]
  };
}
