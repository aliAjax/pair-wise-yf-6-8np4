import test from "node:test";
import assert from "node:assert/strict";
import { emptyLedger, migrateLegacy, normalize, loadLedger, saveLedger } from "../src/store.js";

// 内存版 localStorage，测试存档层不碰浏览器
function memStorage() {
  const map = new Map();
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    map
  };
}

test("旧版数据迁移：事项保留，账目字段留空", () => {
  const legacy = {
    filter: "done",
    repairs: [
      { id: "r1", location: "厨房", title: "水槽渗水", priority: "high", cost: 260, status: "done", photo: "", note: "n" },
      { id: "r2", location: "卫生间", title: "门锁松动", priority: "low", cost: 0, status: "todo", photo: "", note: "" }
    ]
  };
  const migrated = migrateLegacy(legacy);
  assert.equal(migrated.version, 2);
  assert.equal(migrated.filter, "done");
  assert.equal(migrated.repairs.length, 2);
  assert.equal(migrated.repairs[0].estimatedCost, 260);
  assert.equal(migrated.repairs[0].status, "done");
  assert.equal(migrated.repairs[0].invoice, null);
  assert.deepEqual(migrated.repairs[0].invoiceHistory, []);
  assert.deepEqual(migrated.requests, []);
});

test("无存档时启动为空账本；有旧版存档时自动迁移且旧键保留", () => {
  const empty = memStorage();
  assert.deepEqual(loadLedger(empty), emptyLedger());

  const withLegacy = memStorage();
  withLegacy.setItem("zfl-14-repairs", JSON.stringify({ repairs: [{ id: "r1", location: "厨房", title: "渗水", cost: 100, status: "done" }] }));
  const loaded = loadLedger(withLegacy);
  assert.equal(loaded.repairs.length, 1);
  assert.equal(loaded.repairs[0].estimatedCost, 100);
  // 旧键不动，新键已写入
  assert.ok(withLegacy.getItem("zfl-14-repairs"));
  assert.ok(withLegacy.getItem("zfl-14-ledger"));
});

test("存档读写往返，损坏数据回退为空账本", () => {
  const storage = memStorage();
  const state = emptyLedger();
  state.repairs.push({ id: "r1", location: "厨房", title: "渗水", status: "todo" });
  saveLedger(state, storage);
  const loaded = loadLedger(storage);
  assert.equal(loaded.repairs.length, 1);
  assert.equal(loaded.repairs[0].invoiceHistory.length, 0);

  storage.setItem("zfl-14-ledger", "{not json");
  assert.deepEqual(loadLedger(storage), emptyLedger());
});

test("normalize 补齐缺失字段", () => {
  const fixed = normalize({ repairs: [{ id: "r1" }], requests: [{ id: "q1", repairId: "r1", amountCents: 500 }] });
  assert.equal(fixed.repairs[0].status, "todo");
  assert.equal(fixed.repairs[0].invoice, null);
  assert.equal(fixed.requests[0].status, "pending");
  assert.equal(fixed.requests[0].amountCents, 500);
});
