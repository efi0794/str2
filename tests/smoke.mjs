import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (file) => readFileSync(new URL("../" + file, import.meta.url), "utf8");
const schema = read("sql/01_schema.sql");
const views = read("sql/03_views.sql");
const server = read("server.js");
const ui = read("public/app.js");
assert.equal((schema.match(/CREATE TABLE /g) || []).length, 5, "tables count");
assert.equal((views.match(/CREATE OR REPLACE VIEW /g) || []).length, 6, "views count");
for (const name of ["v_task_catalog", "v_daily_task_status", "v_game_progress",
  "v_unfinished_tasks", "v_completed_tasks", "v_latest_resources"]) {
  assert.ok(views.includes(name), "missing view " + name);
}
for (const path of ["/api/dashboard", "/api/tasks", "/api/records", "/api/resources"]) {
  assert.ok(server.includes(path), "missing route " + path);
}
assert.ok(ui.includes("実績登録") && ui.includes("タスク編集"), "missing CRUD UI");
console.log("STR2 smoke checks OK: 5 tables, 6 views, CRUD routes/UI.");
