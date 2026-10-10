import "dotenv/config";
import { createHoYoBridge, collectImportCandidates, importCandidatesIntoOracle } from "./hoyo-bridge.js";
import express from "express";
import oracledb from "oracledb";
import { fileURLToPath } from "node:url";

const { ORACLE_USER, ORACLE_PASSWORD, ORACLE_CONNECT_STRING } = process.env;
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "127.0.0.1";
const USER_ID = 1;
const hoyoBridge = createHoYoBridge(); // 学校での発表用・ローカル単一ユーザー
if (!ORACLE_USER || !ORACLE_PASSWORD || !ORACLE_CONNECT_STRING) {
  console.error("Oracle接続情報が不足しています。.env.exampleを参考に.envを用意してください。");
  process.exit(1);
}
if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) {
  console.error("PORTが不正です。");
  process.exit(1);
}

oracledb.outFormat = oracledb.OUT_FORMAT_OBJECT;
const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "16kb" }));
app.use((req, _res, next) => { req.body ??= {}; next(); });
app.use(express.static(fileURLToPath(new URL("./public/", import.meta.url))));

// ローカルデモ用途。外部公開・複数人利用には認証とCSRF対策が別途必要です。
app.use("/api", (req, res, next) => {
  if (["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) {
    const origin = req.get("origin");
    if (origin && origin !== req.protocol + "://" + req.get("host")) {
      return res.status(403).json({ ok: false, error: "別のオリジンからの更新は禁止されています。" });
    }
  }
  next();
});

class InputError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}
function integer(value, label, min = 0, max = 999999) {
  if (value === "" || value === null || value === undefined) {
    throw new InputError(label + "を入力してください。");
  }
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < min || number > max) {
    throw new InputError(label + "は" + min + "〜" + max + "の整数にしてください。");
  }
  return number;
}
function textValue(value, label, max = 80, required = false) {
  const result = String(value ?? "").trim();
  if ((required && !result) || result.length > max) {
    throw new InputError(label + "は" + (required ? "1〜" : "0〜") + max + "文字で入力してください。");
  }
  return result;
}
function toCamel(row) {
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [
    key.toLowerCase().replace(/_([a-z])/g, (_, c) => c.toUpperCase()), value
  ]));
}
function dbRoute(handler) {
  return async (req, res) => {
    let connection;
    try {
      connection = await oracledb.getConnection();
      await handler(req, res, connection);
    } catch (error) {
      if (connection) {
        try { await connection.rollback(); } catch (rollbackError) { console.error(rollbackError); }
      }
      console.error("[STR2]", error);
      if (res.headersSent) return;
      let status = error.status || 500;
      let message = error.status ? error.message : "データベース処理に失敗しました。学校のOracle接続・SQLを確認してください。";
      if (error.errorNum === 1) { status = 409; message = "同じ日付の実績が既に登録されています。更新を使ってください。"; }
      if (error.errorNum === 2291) { status = 400; message = "指定されたゲームやタスクが存在しません。"; }
      if (error.errorNum === 2292) { status = 409; message = "参照されているデータのため削除できません。"; }
      res.status(status).json({ ok: false, error: message });
    } finally {
      if (connection) {
        try { await connection.close(); } catch (error) { console.error("[CLOSE]", error); }
      }
    }
  };
}

// HoYoLAB API requests are intentionally outside the Oracle connection pool.
app.get("/api/hoyo/status", async (req, res) => {
  try {
    const data = await hoyoBridge.getStatus({ force: req.query.refresh === "1" });
    res.set("Cache-Control", "no-store").json(data);
  } catch (error) {
    console.error("[HOYO]", error?.name || "HoYoLAB取得エラー");
    res.status(502).json({ ok: false, error: "HoYoLABの取得処理に失敗しました。" });
  }
});

// Live HoYoLAB values are imported only after the user explicitly presses a button.
app.post("/api/hoyo/sync", dbRoute(async (_req, res, db) => {
  const status = await hoyoBridge.getStatus();
  if (!status.enabled) {
    throw new InputError("HoYoLABの認証とUIDが未設定です。.envを確認してください。", 400);
  }
  const candidates = collectImportCandidates(status.games);
  if (!candidates.length) {
    throw new InputError("現在、Oracleへ取り込める確定値がありません。HoYoLABの取得状況を確認してください。", 422);
  }
  const result = await importCandidatesIntoOracle(db, candidates, USER_ID);
  res.json({
    ok: true,
    ...result,
    message: "HoYoLABからOracleへ取り込み: 実績" + result.taskRecords +
      "件 / リソース" + result.resources + "件（スキップ" + result.skipped + "件）"
  });
}));

app.get("/api/health", dbRoute(async (_req, res, db) => {
  const result = await db.execute("SELECT TO_CHAR(SYSDATE, 'YYYY-MM-DD HH24:MI:SS') AS DB_TIME FROM dual");
  res.json({ ok: true, dbTime: result.rows[0].DB_TIME, database: "Oracle" });
}));

app.get("/api/dashboard", dbRoute(async (_req, res, db) => {
  // 1つのOracle接続ではDB操作を順番に実行し、並列利用を避ける。
  const date = await db.execute("SELECT TO_CHAR(TRUNC(SYSDATE), 'YYYY-MM-DD') AS TODAY FROM dual");
  const games = await db.execute("SELECT * FROM v_game_progress WHERE user_id = :userId ORDER BY game_id", { userId: USER_ID });
  const tasks = await db.execute("SELECT * FROM v_daily_task_status WHERE user_id = :userId ORDER BY game_id, sort_order, task_id", { userId: USER_ID });
  const resources = await db.execute("SELECT * FROM v_latest_resources WHERE user_id = :userId ORDER BY game_id", { userId: USER_ID });
  res.json({
    ok: true,
    today: date.rows[0].TODAY,
    games: games.rows.map(toCamel),
    tasks: tasks.rows.map(toCamel),
    resources: resources.rows.map(toCamel)
  });
}));

// CREATE: 新規タスクを実表に追加
app.post("/api/tasks", dbRoute(async (req, res, db) => {
  const gameId = integer(req.body.gameId, "ゲームID", 1);
  const title = textValue(req.body.title, "タスク名", 80, true);
  const targetCount = integer(req.body.targetCount, "目標値", 1, 9999);
  await db.execute(
    "INSERT INTO daily_tasks (game_id, title, target_count, sort_order) VALUES (:gameId, :title, :targetCount, 100)",
    { gameId, title, targetCount }
  );
  await db.commit();
  res.status(201).json({ ok: true, message: "タスクを登録しました。" });
}));

// UPDATE: タスク名・目標値・所属ゲームの変更
app.put("/api/tasks/:taskId", dbRoute(async (req, res, db) => {
  const taskId = integer(req.params.taskId, "タスクID", 1);
  const gameId = integer(req.body.gameId, "ゲームID", 1);
  const title = textValue(req.body.title, "タスク名", 80, true);
  const targetCount = integer(req.body.targetCount, "目標値", 1, 9999);
  const result = await db.execute(
    "UPDATE daily_tasks SET game_id = :gameId, title = :title, target_count = :targetCount WHERE task_id = :taskId",
    { gameId, title, targetCount, taskId }
  );
  if (!result.rowsAffected) throw new InputError("タスクが見つかりません。", 404);
  await db.commit();
  res.json({ ok: true, message: "タスクを編集しました。" });
}));

// DELETE: タスクとその実績を削除 (外部キー ON DELETE CASCADE)
app.delete("/api/tasks/:taskId", dbRoute(async (req, res, db) => {
  const taskId = integer(req.params.taskId, "タスクID", 1);
  const result = await db.execute("DELETE FROM daily_tasks WHERE task_id = :taskId", { taskId });
  if (!result.rowsAffected) throw new InputError("タスクが見つかりません。", 404);
  await db.commit();
  res.json({ ok: true, message: "タスクと関連する実績を削除しました。" });
}));

// CREATE: 当日のタスク実績を登録する
app.post("/api/records", dbRoute(async (req, res, db) => {
  const taskId = integer(req.body.taskId, "タスクID", 1);
  const progress = integer(req.body.progress, "進捗", 0, 9999);
  const note = textValue(req.body.note, "メモ", 200);
  await db.execute(
    "INSERT INTO task_records (user_id, task_id, record_date, progress, note) " +
    "VALUES (:userId, :taskId, TRUNC(SYSDATE), :progress, :note)",
    { userId: USER_ID, taskId, progress, note }
  );
  await db.commit();
  res.status(201).json({ ok: true, message: "今日の実績を登録しました。" });
}));

// UPDATE: 登録済みの当日実績を更新する
app.put("/api/records/:taskId", dbRoute(async (req, res, db) => {
  const taskId = integer(req.params.taskId, "タスクID", 1);
  const progress = integer(req.body.progress, "進捗", 0, 9999);
  const note = textValue(req.body.note, "メモ", 200);
  const result = await db.execute(
    "UPDATE task_records SET progress = :progress, note = :note, updated_at = SYSTIMESTAMP " +
    "WHERE user_id = :userId AND task_id = :taskId AND record_date = TRUNC(SYSDATE)",
    { progress, note, userId: USER_ID, taskId }
  );
  if (!result.rowsAffected) throw new InputError("今日の実績がありません。新規登録してください。", 404);
  await db.commit();
  res.json({ ok: true, message: "実績を更新しました。" });
}));

// DELETE: 当日の実績を削除 (タスク自体は残る)
app.delete("/api/records/:taskId", dbRoute(async (req, res, db) => {
  const taskId = integer(req.params.taskId, "タスクID", 1);
  const result = await db.execute(
    "DELETE FROM task_records WHERE user_id = :userId AND task_id = :taskId AND record_date = TRUNC(SYSDATE)",
    { userId: USER_ID, taskId }
  );
  if (!result.rowsAffected) throw new InputError("削除する実績がありません。", 404);
  await db.commit();
  res.json({ ok: true, message: "今日の実績を削除しました。" });
}));

// リソース（開拓力・樹脂・バッテリーなど）の手動記録
app.post("/api/resources", dbRoute(async (req, res, db) => {
  const gameId = integer(req.body.gameId, "ゲームID", 1);
  const currentAmount = integer(req.body.currentAmount, "現在値", 0, 999999);
  const game = await db.execute("SELECT resource_max FROM games WHERE game_id = :gameId", { gameId });
  if (!game.rows.length) throw new InputError("ゲームが見つかりません。", 404);
  if (currentAmount > game.rows[0].RESOURCE_MAX) {
    throw new InputError("現在値は最大値以下にしてください。");
  }
  await db.execute(
    "INSERT INTO resource_logs (user_id, game_id, current_amount, max_amount) " +
    "VALUES (:userId, :gameId, :currentAmount, :maxAmount)",
    { userId: USER_ID, gameId, currentAmount, maxAmount: game.rows[0].RESOURCE_MAX }
  );
  await db.commit();
  res.status(201).json({ ok: true, message: "リソースを記録しました。" });
}));

app.use("/api", (_req, res) => res.status(404).json({ ok: false, error: "APIが見つかりません。" }));
app.use((error, _req, res, _next) => {
  console.error(error);
  if (error.type === "entity.parse.failed") {
    return res.status(400).json({ ok: false, error: "JSON形式を確認してください。" });
  }
  res.status(500).json({ ok: false, error: "サーバーエラーです。" });
});

try {
  await oracledb.createPool({
    user: ORACLE_USER,
    password: ORACLE_PASSWORD,
    connectString: ORACLE_CONNECT_STRING,
    poolMin: 1,
    poolMax: 4,
    poolIncrement: 1
  });
  const server = app.listen(PORT, HOST, () => {
    console.log("STR2 Oracle Edition: http://" + HOST + ":" + PORT);
    console.log("公開モードではありません。ローカル発表用です。");
  });
  const stop = async () => {
    server.close();
    try { await oracledb.getPool().close(10); } catch (error) { console.error(error); }
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
} catch (error) {
  console.error("Oracle接続プールの初期化に失敗しました:", error.message);
  process.exit(1);
}
