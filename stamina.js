// HoYoLABの観測値から「見かけの減少」を記録するための独立ロジック。
// 自動取得は実際の消費時刻・量を通知しないため、ESTIMATEDは観測時刻と最小の減少差分に限定する。

const GAME_CODES = new Set(["hsr", "genshin", "zzz"]);
const ORACLE_TZ_FORMAT = 'YYYY-MM-DD"T"HH24:MI:SS.FF3TZH:TZM';
const isoToOracle = (iso) => iso.replace(/Z$/, "+00:00");
const validResource = (n) => typeof n === "number" && Number.isSafeInteger(n) && n >= 0 && n <= 999999;
const parsedTime = (value) => typeof value === "string" && !Number.isNaN(Date.parse(value)) ? Date.parse(value) : null;

export function resourceObservations(games, fetchedAt) {
  const time = parsedTime(fetchedAt);
  if (time === null || !Number.isFinite(time) || !new Date(time).toISOString().endsWith("Z")) return [];
  return (Array.isArray(games) ? games : []).flatMap((game) => {
    if (!game || !GAME_CODES.has(game.id) || !game.authenticated || game.error) return [];
    const current = game.resource?.current;
    const maximum = game.resource?.max;
    if (!validResource(current) || !validResource(maximum) || maximum < 1 || current > maximum) return [];
    return [{ gameCode: game.id, currentAmount: current, maxAmount: maximum, fetchedAt: new Date(time).toISOString() }];
  });
}

export function checkManualTime(value, now = Date.now()) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) {
    throw new Error("日時は「YYYY-MM-DDTHH:mm」形式で入力してください。");
  }
  const [year, month, day, hour, minute] = value.match(/\d+/g).map(Number);
  const utc = Date.UTC(year, month - 1, day, hour - 9, minute);
  const valid = new Date(utc);
  const isoInJapan = new Date(utc + 9 * 3600000).toISOString().slice(0, 16);
  if (!Number.isFinite(utc) || valid.getUTCFullYear() < 2000 || isoInJapan !== value) {
    throw new Error("存在しない日時です。");
  }
  if (utc > now + 5 * 60000) throw new Error("未来の時刻は指定できません。");
  if (utc < now - 5 * 365 * 86400000) throw new Error("5年以上前の時刻は指定できません。");
  return value;
}

export async function saveResourceObservations(db, observations, userId = 1) {
  let snapshots = 0, estimated = 0, skipped = 0;
  for (const item of observations) {
    const game = await db.execute("SELECT game_id FROM games WHERE game_code = :code", { code: item.gameCode });
    if (!game.rows?.length) { skipped++; continue; }
    const gameId = game.rows[0].GAME_ID;
    const previous = await db.execute(
      "SELECT current_amount, max_amount, " +
      "TO_CHAR(observed_at,'YYYY-MM-DD\"T\"HH24:MI:SS.FF3TZH:TZM') AS PREVIOUS_ISO " +
      "FROM hoyo_resource_snapshots WHERE user_id = :userId AND game_id = :gameId " +
      "ORDER BY observed_at DESC, snapshot_id DESC FETCH FIRST 1 ROW ONLY",
      { userId, gameId }
    );
    const prior = previous.rows?.[0] ?? null;
    const fetchedMs = Date.parse(item.fetchedAt);
    const prevMs = prior ? Date.parse(prior.PREVIOUS_ISO) : null;
    if (prior && (prevMs === null || !Number.isFinite(prevMs) || fetchedMs <= prevMs)) {
      skipped++;
      continue; // 同じ時刻の再取得・古いキャッシュ・逆順の取得は保存しない
    }
    const observedAt = isoToOracle(item.fetchedAt);
    const observedAtKey = new Date(fetchedMs).toISOString(); // UTCキー: TIMESTAMP WITH TIME ZONE はUNIQUE不可
    try {
      await db.execute(
        "INSERT INTO hoyo_resource_snapshots " +
        "(user_id, game_id, current_amount, max_amount, observed_at, observed_at_key) " +
        "VALUES (:userId, :gameId, :currentAmount, :maxAmount, " +
        "TO_TIMESTAMP_TZ(:observedAt, '" + ORACLE_TZ_FORMAT + "'), :observedAtKey)",
        { userId, gameId, currentAmount: item.currentAmount, maxAmount: item.maxAmount, observedAt, observedAtKey }
      );
    } catch (err) {
      if (err?.errorNum === 1) { skipped++; continue; } // 並列要求時の重複だけ無視
      throw err;
    }
    snapshots++;

    // 回復も同時に起きるので「減少量」は厳密な消費量ではない。
    if (prior && Number(prior.MAX_AMOUNT) === item.maxAmount &&
        Number(prior.CURRENT_AMOUNT) > item.currentAmount) {
      const drop = Number(prior.CURRENT_AMOUNT) - item.currentAmount;
      await db.execute(
        "INSERT INTO stamina_use_logs " +
        "(user_id, game_id, amount, used_at, source, note, snapshot_id) " +
        "SELECT :userId, :gameId, :amount, observed_at, 'ESTIMATED', :note, snapshot_id " +
        "FROM hoyo_resource_snapshots WHERE user_id = :userId AND game_id = :gameId " +
        "AND observed_at_key = :observedAtKey",
        {
          userId, gameId, amount: drop, observedAtKey,
          note: "観測時の減少差分（使用時刻ではありません）"
        }
      );
      estimated++;
    }
  }
  if (snapshots > 0) await db.commit();
  return { snapshots, estimated, skipped };
}
