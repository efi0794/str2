import assert from "node:assert/strict";
import {
  createHoYoBridge, collectImportCandidates, importCandidatesIntoOracle
} from "../hoyo-bridge.js";

// テストではHoYoLABにもOracleにも接続しない
const disabled = createHoYoBridge({
  env: {}, fetchStatuses: () => { throw new Error("must not fetch"); }
});
const inactive = await disabled.getStatus();
assert.equal(inactive.enabled, false);
assert.equal(inactive.games.length, 3);

let now = 100_000;
let calls = 0;
const games = [
  {
    id: "hsr", name: "崩壊：スターレイル", configured: true, authenticated: true,
    uid: "123456789", error: null,
    daily: { current: 300, max: 500, completed: false },
    resource: { current: 120, max: 300 }
  },
  {
    id: "genshin", configured: true, authenticated: true, error: null,
    daily: { current: 4, max: 4, rewardReceived: false },
    resource: { current: 80, max: 200 }
  },
  {
    id: "zzz", configured: true, authenticated: true, error: null,
    daily: { current: null, max: null, completed: null },
    resource: { current: null, max: null }
  }
];
const live = createHoYoBridge({
  env: {
    HOYO_LTOKEN_V2: "fake_for_test_only",
    HOYO_LTUID_V2: "123456",
    HSR_UID: "123456789",
    GENSHIN_UID: "987654321",
    ZZZ_UID: "678901234"
  },
  fetchStatuses: async () => { calls++; return { games }; },
  now: () => now
});
const first = await live.getStatus();
assert.equal(first.enabled, true);
assert.equal(calls, 1);
assert.equal(first.games[0].daily.current, 300);
await live.getStatus();
assert.equal(calls, 1);
now += 61_000;
await live.getStatus({ force: true });
assert.equal(calls, 2);

const candidates = collectImportCandidates(games);
assert.equal(candidates.length, 5, "HSR 2 + Genshin 3");
assert.equal(candidates.filter(c => c.kind === "task").length, 3);
assert.ok(candidates.some(c => c.title === "追加報酬の受取" && c.progress === 0));
assert.equal(collectImportCandidates([{ ...games[0], authenticated: false }]).length, 0);
assert.equal(collectImportCandidates([{ ...games[0], daily: { current: null, max: null },
  resource: { current: null, max: null } }]).length, 0);

// SQLへのバインド・対象判定のモックテスト
let committed = false;
let merged = 0;
let resourceInserts = 0;
const mockDb = {
  async execute(sql, binds) {
    if (sql.startsWith("SELECT game_id FROM games")) return { rows: [{ GAME_ID: binds.code === "hsr" ? 1 : 2 }] };
    if (sql.startsWith("SELECT task_id, target_count FROM daily_tasks")) {
      const targets = { "デイリー訓練": 500, "デイリー依頼": 4, "追加報酬の受取": 1 };
      return { rows: [{ TASK_ID: 10, TARGET_COUNT: targets[binds.title] }] };
    }
    if (sql.startsWith("MERGE INTO task_records")) {
      assert.ok(binds.taskId && binds.userId);
      assert.equal(binds.updateProgress, binds.insertProgress);
      merged++;
    }
    if (sql.startsWith("INSERT INTO resource_logs")) resourceInserts++;
    return { rows: [] };
  },
  async commit() { committed = true; }
};
const result = await importCandidatesIntoOracle(mockDb, candidates, 1);
assert.equal(result.taskRecords, 3);
assert.equal(result.resources, 2);
assert.equal(result.skipped, 0);
assert.equal(merged, 3);
assert.equal(resourceInserts, 2);
assert.equal(committed, true);
console.log("HoYoLAB cache, null safety, Oracle import mock tests OK.");
