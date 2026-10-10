import assert from "node:assert/strict";
import { resourceObservations, checkManualTime, saveResourceObservations } from "../stamina.js";

const fetchedAt = "2026-10-10T04:20:00.000Z";
const valid = (current, maximum = 300) => ({
  id: "hsr", authenticated: true, error: null,
  resource: { current, max: maximum }
});
assert.equal(resourceObservations([valid(120)], fetchedAt).length, 1);
assert.equal(resourceObservations([{ ...valid(120), authenticated: false }], fetchedAt).length, 0);
assert.equal(resourceObservations([valid(null)], fetchedAt).length, 0);
assert.equal(resourceObservations([valid(400)], fetchedAt).length, 0);
assert.equal(resourceObservations([valid(0)], fetchedAt).length, 1);

assert.equal(checkManualTime("2026-10-10T13:30", Date.parse("2026-10-10T05:00:00.000Z")),
  "2026-10-10T13:30");
assert.throws(() => checkManualTime("2026-02-30T13:30"));
assert.throws(() => checkManualTime("2026-10-10T25:30"));
assert.throws(() => checkManualTime("2026-10-10T18:00", Date.parse("2026-10-10T05:00:00.000Z")));

let previous = null;
let inserted = 0;
let uses = 0;
let commits = 0;
const db = {
  async execute(sql, binds) {
    if (sql.startsWith("SELECT game_id FROM games")) return { rows: [{ GAME_ID: 1 }] };
    if (sql.includes("FROM hoyo_resource_snapshots WHERE user_id") && sql.startsWith("SELECT current_amount")) {
      return { rows: previous ? [{
        CURRENT_AMOUNT: previous.value, MAX_AMOUNT: previous.max, PREVIOUS_ISO: previous.at
      }] : [] };
    }
    if (sql.startsWith("INSERT INTO hoyo_resource_snapshots")) {
      assert.match(sql, /observed_at_key/);
      assert.match(binds.observedAtKey, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);
      previous = { value: binds.currentAmount, max: binds.maxAmount, at: binds.observedAt };
      inserted++;
    }
    if (sql.startsWith("INSERT INTO stamina_use_logs")) {
      assert.match(sql, /observed_at_key = :observedAtKey/);
      assert.match(binds.observedAtKey, /^\d{4}-\d\d-\d\dT/);
      assert.equal(binds.amount, 50);
      uses++;
    }
    return { rows: [] };
  },
  async commit() { commits++; }
};
const one = await saveResourceObservations(db, resourceObservations([valid(120)], fetchedAt));
assert.deepEqual(one, { snapshots: 1, estimated: 0, skipped: 0 });
const two = await saveResourceObservations(db, resourceObservations(
  [valid(70)], "2026-10-10T04:30:00.000Z"
));
assert.deepEqual(two, { snapshots: 1, estimated: 1, skipped: 0 });
const repeat = await saveResourceObservations(db, resourceObservations(
  [valid(70)], "2026-10-10T04:30:00.000Z"
));
assert.deepEqual(repeat, { snapshots: 0, estimated: 0, skipped: 1 });
const increased = await saveResourceObservations(db, resourceObservations(
  [valid(100)], "2026-10-10T04:40:00.000Z"
));
assert.deepEqual(increased, { snapshots: 1, estimated: 0, skipped: 0 });
assert.equal(inserted, 3);
assert.equal(uses, 1);
assert.equal(commits, 3);

console.log("Stamina stats history: observation, no duplicates, decrease detection, input validation OK.");
