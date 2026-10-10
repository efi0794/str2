import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (file) => readFileSync(new URL("../" + file, import.meta.url), "utf8");
const schema = read("sql/01_schema.sql");
const staminaSql = read("sql/06_stamina_history.sql");
const views = read("sql/03_views.sql");
const server = read("server.js");
const ui = read("public/app.js");
assert.equal((schema.match(/CREATE TABLE /g) || []).length, 5, "tables count");
assert.equal((views.match(/CREATE OR REPLACE VIEW /g) || []).length, 6, "base views count");
assert.equal((staminaSql.match(/CREATE TABLE /g) || []).length, 2, "stamina history tables count");
assert.equal((staminaSql.match(/CREATE OR REPLACE VIEW /g) || []).length, 3, "stamina history views count");
for (const name of ["v_task_catalog", "v_daily_task_status", "v_game_progress",
  "v_unfinished_tasks", "v_completed_tasks", "v_latest_resources"]) {
  assert.ok(views.includes(name), "missing view " + name);
}
for (const path of ["/api/dashboard", "/api/tasks", "/api/records", "/api/resources"]) {
  assert.ok(server.includes(path), "missing route " + path);
}
assert.ok(ui.includes("実績登録") && ui.includes("タスク編集"), "missing CRUD UI");
assert.ok(server.includes("/api/stamina/analytics") && server.includes("/api/stamina/observe"), "stamina API missing");
assert.ok(read("public/index.html").includes("staminaPanel"), "stamina UI missing");
console.log("STR2 smoke checks OK: 7 tables, 9 views, CRUD and stamina analytics routes/UI.");
