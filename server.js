import "dotenv/config";
import { createHoYoBridge, collectImportCandidates, importCandidatesIntoOracle } from "./hoyo-bridge.js";
import express from "express";
import oracledb from "oracledb";
import { fileURLToPath } from "node:url";
import { resourceObservations, saveResourceObservations, checkManualTime } from "./stamina.js";

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


// --- スタミナ履歴・消費時間統計 ---
// HoYoLABの新鮮な観測値を自動保存する。タスク・手動記録を上書きしない。
// GETで副作用を起こさないよう、フロントエンドから明示的なPOSTを発行する。
let observationQueue = Promise.resolve();
app.post("/api/stamina/observe", dbRoute(async (_req, res, db) => {
  const before = observationQueue;
  let unlock;
  observationQueue = new Promise(resolve => { unlock = resolve; });
  await before;
  try {
    const status = await hoyoBridge.getStatus();
    if (!status.enabled || !status.fetchedAt) {
      return res.json({ ok: true, snapshots: 0, estimated: 0, skipped: 0 });
    }
    const candidates = resourceObservations(status.games, status.fetchedAt);
    const result = await saveResourceObservations(db, candidates, USER_ID);
    res.json({ ok: true, ...result });
  } finally {
    unlock();
  }
}));

function staminaFilters(req) {
  const days = integer(req.query.days ?? 30, "集計期間", 7, 365);
  if (![7, 30, 90, 365].includes(days)) throw new InputError("集計期間は7・30・90・365日から選んでください。");
  const gameId = integer(req.query.gameId ?? 0, "ゲームID", 0, 3);
  return { days, gameId, userId: USER_ID };
}

// Oracle VIEWを使い、直近N日間の使用時間帯/日別統計・履歴を返す
app.get("/api/stamina/analytics", dbRoute(async (req, res, db) => {
  const binds = staminaFilters(req);
  const where =
    "WHERE user_id = :userId AND (:gameId = 0 OR game_id = :gameId) " +
    "AND used_at >= SYSTIMESTAMP - NUMTODSINTERVAL(:days, 'DAY')";
  const summary = await db.execute(
    "SELECT source, COUNT(*) AS event_count, NVL(SUM(amount), 0) AS total_amount " +
    "FROM v_stamina_use_history " + where + " GROUP BY source", binds
  );
  const hours = await db.execute(
    "SELECT hour_jst, source, COUNT(*) AS event_count, SUM(amount) AS total_amount " +
    "FROM v_stamina_use_history " + where + " GROUP BY hour_jst, source ORDER BY hour_jst, source", binds
  );
  const days = await db.execute(
    "SELECT TO_CHAR(used_at AT TIME ZONE '+09:00', 'YYYY-MM-DD') AS day_jst, source, " +
    "COUNT(*) AS event_count, SUM(amount) AS total_amount " +
    "FROM v_stamina_use_history " + where +
    " GROUP BY TO_CHAR(used_at AT TIME ZONE '+09:00', 'YYYY-MM-DD'), source " +
    "ORDER BY day_jst DESC, source", binds
  );
  const history = await db.execute(
    "SELECT use_id, game_id, game_name, amount, source, note, used_at_jst " +
    "FROM v_stamina_use_history " + where +
    " ORDER BY used_at DESC, use_id DESC FETCH FIRST 100 ROWS ONLY", binds
  );

  // HoYoLAB自動観測値と、既存のOracle記録履歴を同じ画面で閲覧できる
  const resources = await db.execute(
    "SELECT entry_id, game_id, game_name, current_amount, max_amount, source, observed_at_jst " +
    "FROM (" +
    " SELECT s.snapshot_id AS entry_id, s.game_id, g.game_name, " +
    "s.current_amount, s.max_amount, 'HOYOLAB' AS source, s.observed_at AS observed_at, " +
    "TO_CHAR(s.observed_at AT TIME ZONE '+09:00', 'YYYY-MM-DD HH24:MI') AS observed_at_jst " +
    "FROM hoyo_resource_snapshots s JOIN games g ON g.game_id = s.game_id " +
    "WHERE s.user_id = :userId " +
    "UNION ALL " +
    "SELECT r.resource_id AS entry_id, r.game_id, g.game_name, " +
    "r.current_amount, r.max_amount, 'ORACLE' AS source, " +
    "FROM_TZ(r.measured_at, SESSIONTIMEZONE) AS observed_at, " +
    "TO_CHAR(FROM_TZ(r.measured_at, SESSIONTIMEZONE) AT TIME ZONE '+09:00', 'YYYY-MM-DD HH24:MI') AS observed_at_jst " +
    "FROM resource_logs r JOIN games g ON g.game_id = r.game_id " +
    "WHERE r.user_id = :userId" +
    ") WHERE (:gameId = 0 OR game_id = :gameId) " +
    "AND observed_at >= SYSTIMESTAMP - NUMTODSINTERVAL(:days, 'DAY') " +
    "ORDER BY observed_at DESC, entry_id DESC FETCH FIRST 100 ROWS ONLY", binds
  );
  res.json({
    ok: true, filters: { gameId: binds.gameId, days: binds.days },
    summary: summary.rows.map(toCamel), hours: hours.rows.map(toCamel),
    daily: days.rows.map(toCamel), history: history.rows.map(toCamel),
    resourceHistory: resources.rows.map(toCamel)
  });
}));

// 正確に分かる場合は手動の時刻・消費量を記録
app.post("/api/stamina/use", dbRoute(async (req, res, db) => {
  const gameId = integer(req.body.gameId, "ゲームID", 1, 3);
  const amount = integer(req.body.amount, "消費量", 1, 999999);
  const note = textValue(req.body.note, "メモ", 200);
  let usedAt;
  try { usedAt = checkManualTime(req.body.usedAt); }
  catch (error) { throw new InputError(error.message); }
  await db.execute(
    "INSERT INTO stamina_use_logs (user_id, game_id, amount, used_at, source, note) " +
    "VALUES (:userId, :gameId, :amount, " +
    "FROM_TZ(TO_TIMESTAMP(:usedAt, 'YYYY-MM-DD\"T\"HH24:MI'), '+09:00'), 'MANUAL', :note)",
    { userId: USER_ID, gameId, amount, usedAt, note }
  );
  await db.commit();
  res.status(201).json({ ok: true, message: "使用履歴を登録しました。" });
}));

// 手動・推定どちらも1件ずつ削除できる。観測スナップショットは残すため同一取得から復活しない。
app.delete("/api/stamina/use/:id", dbRoute(async (req, res, db) => {
  const id = integer(req.params.id, "履歴ID", 1);
  const result = await db.execute(
    "DELETE FROM stamina_use_logs WHERE use_id = :id AND user_id = :userId",
    { id, userId: USER_ID }
  );
  if (!result.rowsAffected) throw new InputError("履歴が見つかりません。", 404);
  await db.commit();
  res.json({ ok: true, message: "消費履歴を削除しました。" });
}));

// 元からあるresource_logs側の個別履歴も削除可能にする
app.delete("/api/resources/:id", dbRoute(async (req, res, db) => {
  const id = integer(req.params.id, "リソース履歴ID", 1);
  const result = await db.execute(
    "DELETE FROM resource_logs WHERE resource_id = :id AND user_id = :userId",
    { id, userId: USER_ID }
  );
  if (!result.rowsAffected) throw new InputError("リソース履歴が見つかりません。", 404);
  await db.commit();
  res.json({ ok: true, message: "リソース履歴を削除しました。" });
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
