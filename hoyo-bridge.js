import { getAllGameStatuses } from "./hoyo.js";

const GAME_CONFIG = [
  { id: "hsr", name: "崩壊：スターレイル", accent: "blue", key: "HSR_UID" },
  { id: "genshin", name: "原神", accent: "gold", key: "GENSHIN_UID" },
  { id: "zzz", name: "ゼンレスゾーンゼロ", accent: "lime", key: "ZZZ_UID" }
];

function configFromEnv(env) {
  const ltoken = String(env.HOYO_LTOKEN_V2 ?? "").trim();
  const ltuid = String(env.HOYO_LTUID_V2 ?? "").trim();
  const hasCredentials = Boolean(ltoken && /^\d+$/.test(ltuid) && Number.isSafeInteger(Number(ltuid)));
  const uids = Object.fromEntries(GAME_CONFIG.map(game => {
    const value = String(env[game.key] ?? "").trim();
    return [game.id, /^\d{6,12}$/.test(value) ? value : null];
  }));
  return { ltoken, ltuid, hasCredentials, uids };
}

function unconfiguredGames(config) {
  return GAME_CONFIG.map(game => ({
    id: game.id, name: game.name, accent: game.accent,
    uid: config.uids[game.id], configured: Boolean(config.uids[game.id]),
    authenticated: false,
    daily: { label: "デイリー", current: null, max: null, completed: null, detail: "未取得" },
    resource: { label: "リソース", current: null, max: null, recoverySeconds: null },
    extras: [], checkIn: null,
    error: config.uids[game.id]
      ? { kind: "config", message: "HoYoLAB認証情報が設定されていません。.envを確認してください。" }
      : null
  }));
}

export function createHoYoBridge({
  env = process.env,
  fetchStatuses = getAllGameStatuses,
  now = () => Date.now(),
  ttlMs = 5 * 60_000,
  minForceMs = 60_000
} = {}) {
  let latest = null;
  let inFlight = null;
  let fetchedAtMs = 0;

  async function getStatus({ force = false } = {}) {
    const config = configFromEnv(env);
    const enabled = config.hasCredentials && GAME_CONFIG.some(game => config.uids[game.id]);
    if (!enabled) {
      return {
        ok: true, enabled: false, cached: false, fetchedAt: null,
        games: unconfiguredGames(config),
        message: "HoYoLABのCookieとゲームUIDを.envに設定すると自動取得が有効になります。"
      };
    }

    if (inFlight) return inFlight;
    const age = now() - fetchedAtMs;
    if (latest && age >= 0 && age < (force ? minForceMs : ttlMs)) {
      return { ...latest, cached: true };
    }
    inFlight = (async () => {
      try {
        const result = await fetchStatuses({
          cookie: { ltokenV2: config.ltoken, ltuidV2: Number(config.ltuid) },
          hsrUid: config.uids.hsr,
          genshinUid: config.uids.genshin,
          zzzUid: config.uids.zzz
        });
        latest = {
          ok: true, enabled: true, cached: false,
          fetchedAt: new Date(now()).toISOString(),
          games: result.games
        };
        fetchedAtMs = now();
        return latest;
      } catch (_error) {
        // Cookieなどの機密情報をエラーメッセージに混ぜない
        const fallback = {
          ok: true, enabled: true, cached: false,
          fetchedAt: new Date(now()).toISOString(),
          games: unconfiguredGames(config).map(game => ({
            ...game,
            error: game.configured
              ? { kind: "api", message: "HoYoLABの情報を取得できませんでした。" }
              : null
          }))
        };
        latest = fallback;
        fetchedAtMs = now();
        return fallback;
      } finally {
        inFlight = null;
      }
    })();
    return inFlight;
  }
  return { getStatus };
}

function validCount(value) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= 9999;
}

/**
 * 日課の自動取得を、既存のデフォルトタスクに対応付ける。
 * 不明な値は補完しない。DBへの保存は利用者の「Oracleに取り込む」操作のみ。
 */
export function collectImportCandidates(games) {
  const candidates = [];
  for (const game of games) {
    if (!game?.authenticated || game?.error || !["hsr", "genshin", "zzz"].includes(game.id)) {
      continue;
    }
    const daily = game.daily || {};
    if (validCount(daily.current) && validCount(daily.max) && daily.max > 0 && daily.current <= daily.max) {
      const title = {
        hsr: "デイリー訓練",
        genshin: "デイリー依頼",
        zzz: "活躍度"
      }[game.id];
      candidates.push({
        gameCode: game.id, kind: "task", title, progress: daily.current,
        expectedTarget: daily.max
      });
    }
    if (game.id === "genshin" && typeof daily.rewardReceived === "boolean") {
      candidates.push({
        gameCode: game.id, kind: "task",
        title: "追加報酬の受取", progress: daily.rewardReceived ? 1 : 0,
        expectedTarget: 1
      });
    }
    const current = game.resource?.current;
    const maximum = game.resource?.max;
    if (validCount(current) && validCount(maximum) && maximum > 0 && current <= maximum) {
      candidates.push({
        gameCode: game.id, kind: "resource",
        currentAmount: current, maxAmount: maximum
      });
    }
  }
  return candidates;
}

export async function importCandidatesIntoOracle(db, candidates, userId = 1) {
  let taskRecords = 0;
  let resources = 0;
  let skipped = 0;
  for (const candidate of candidates) {
    const game = await db.execute(
      "SELECT game_id FROM games WHERE game_code = :code",
      { code: candidate.gameCode }
    );
    if (!game.rows.length) { skipped++; continue; }
    const gameId = game.rows[0].GAME_ID;
    if (candidate.kind === "resource") {
      // HoYoLAB側で上限が変わった場合にも対応
      await db.execute("UPDATE games SET resource_max = :maximum WHERE game_id = :gameId", {
        maximum: candidate.maxAmount, gameId
      });
      await db.execute(
        "INSERT INTO resource_logs (user_id, game_id, current_amount, max_amount) " +
        "VALUES (:userId, :gameId, :currentAmount, :maxAmount)",
        { userId, gameId, currentAmount: candidate.currentAmount, maxAmount: candidate.maxAmount }
      );
      resources++;
      continue;
    }
    const task = await db.execute(
      "SELECT task_id, target_count FROM daily_tasks " +
      "WHERE game_id = :gameId AND title = :title AND is_active = 1 " +
      "ORDER BY task_id FETCH FIRST 1 ROW ONLY",
      { gameId, title: candidate.title }
    );
    if (!task.rows.length || Number(task.rows[0].TARGET_COUNT) !== candidate.expectedTarget) {
      skipped++;
      continue;
    }
    const taskId = task.rows[0].TASK_ID;
    await db.execute(
      "MERGE INTO task_records r USING " +
      "(SELECT :userId AS user_id, :taskId AS task_id, TRUNC(SYSDATE) AS record_date FROM dual) x " +
      "ON (r.user_id = x.user_id AND r.task_id = x.task_id AND r.record_date = x.record_date) " +
      "WHEN MATCHED THEN UPDATE SET r.progress = :updateProgress, r.note = :updateNote, r.updated_at = SYSTIMESTAMP " +
      "WHEN NOT MATCHED THEN INSERT (user_id, task_id, record_date, progress, note) " +
      "VALUES (x.user_id, x.task_id, x.record_date, :insertProgress, :insertNote)",
      {
        userId, taskId,
        updateProgress: candidate.progress, insertProgress: candidate.progress,
        updateNote: "HoYoLABから取り込み", insertNote: "HoYoLABから取り込み"
      }
    );
    taskRecords++;
  }
  if (taskRecords || resources) await db.commit();
  return { taskRecords, resources, skipped };
}
