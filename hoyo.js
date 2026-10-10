import {
  GenshinImpact,
  HonkaiStarRail,
  ZenlessZoneZero,
  LanguageEnum
} from "node-hoyolab";

const toNumber = (value, fallback = null) => {
  if (value === null || value === undefined || value === "") return fallback;
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
};

function normalizeError(error) {
  const message = error?.message || "HoYoLAB API request failed";
  const code = error?.code ?? error?.retcode ?? null;
  const auth = /login|cookie|token|auth|expired|10001/i.test(message) || code === 10001 || code === -100;
  return {
    kind: auth ? "auth" : "api",
    message: auth
      ? "HoYoLAB認証が無効または期限切れの可能性があります。.envのCookieを更新してください。"
      : "HoYoLABのAPI取得に失敗しました。しばらくしてから再取得してください。"
  };
}

async function safeCheckIn(client) {
  try {
    const info = await client.daily.info();
    return {
      available: true,
      signedToday: info?.is_sign ?? info?.is_signed ?? info?.signed ?? null,
      totalSignDays: info?.total_sign_day ?? info?.total_signed ?? null
    };
  } catch {
    return { available: false, signedToday: null, totalSignDays: null };
  }
}

function baseGame(id, name, uid, accent) {
  return {
    id,
    name,
    uid: uid || null,
    configured: Boolean(uid),
    accent,
    authenticated: false,
    daily: { label: "デイリー", current: null, max: null, completed: null, detail: "判定できません" },
    resource: { label: "リソース", current: null, max: null, recoverySeconds: null },
    extras: [],
    checkIn: null,
    error: null
  };
}

export async function getHsrStatus(credentials) {
  const uid = credentials.hsrUid;
  const out = baseGame("hsr", "崩壊：スターレイル", uid, "blue");
  if (!uid) return out;
  try {
    const client = new HonkaiStarRail({
      cookie: credentials.cookie,
      uid: Number(uid),
      lang: LanguageEnum.JAPANESE
    });
    const [note, checkIn] = await Promise.all([client.record.note(), safeCheckIn(client)]);
    out.authenticated = true;
    out.checkIn = checkIn;

    const current =
      note?.current_train_score ??
      note?.current_training_score ??
      note?.daily_training?.current ??
      note?.training?.current ??
      null;
    const max =
      note?.max_train_score ??
      note?.max_training_score ??
      note?.daily_training?.max ??
      note?.training?.max ??
      (current !== null ? 500 : null);

    out.daily = {
      label: "デイリー訓練",
      current: toNumber(current),
      max: toNumber(max),
      completed: current !== null && max !== null ? Number(current) >= Number(max) : null,
      detail:
        current !== null && max !== null
          ? "訓練スコア"
          : "HoYoLABの現在の応答ではデイリー訓練スコアを判定できません"
    };
    out.resource = {
      label: "開拓力",
      current: toNumber(note?.current_stamina),
      max: toNumber(note?.max_stamina),
      recoverySeconds: toNumber(note?.stamina_recover_time, 0)
    };
    const expeditions = Array.isArray(note?.expeditions) ? note.expeditions : [];
    const finished = expeditions.filter((item) => /finish|complete/i.test(String(item?.status))).length;
    out.extras = [
      { label: "派遣", value: expeditions.length ? `${finished} / ${expeditions.length} 完了` : "0件" }
    ];
  } catch (error) {
    out.error = normalizeError(error);
  }
  return out;
}

export async function getGenshinStatus(credentials) {
  const uid = credentials.genshinUid;
  const out = baseGame("genshin", "原神", uid, "gold");
  if (!uid) return out;
  try {
    const client = new GenshinImpact({
      cookie: credentials.cookie,
      uid: Number(uid),
      lang: LanguageEnum.JAPANESE
    });
    const [note, checkIn] = await Promise.all([client.record.dailyNote(), safeCheckIn(client)]);
    out.authenticated = true;
    out.checkIn = checkIn;

    const current = toNumber(note?.finished_task_num);
    const max = toNumber(note?.total_task_num);
    const tasksDone = current !== null && max !== null && max > 0 && current >= max;
    const rewardReceived = typeof note?.is_extra_task_reward_received === "boolean"
      ? note.is_extra_task_reward_received : null;
    out.daily = {
      label: "デイリー依頼",
      current,
      max,
      completed: current === null || max === null || max === 0
        ? null : (tasksDone ? rewardReceived : false),
      rewardReceived,
      detail: current === null || max === null || max === 0
        ? "HoYoLABからデイリー依頼の数を判定できません"
        : tasksDone
        ? rewardReceived === true
          ? "依頼完了・追加報酬受取済み"
          : "依頼は完了、冒険者協会の追加報酬が未受取"
        : `${current} / ${max} 件完了`
    };
    out.resource = {
      label: "天然樹脂",
      current: toNumber(note?.current_resin),
      max: toNumber(note?.max_resin),
      recoverySeconds: toNumber(note?.resin_recovery_time, 0)
    };
    const expeditions = Array.isArray(note?.expeditions) ? note.expeditions : [];
    const finished = expeditions.filter((item) => /finish|complete/i.test(String(item?.status))).length;
    out.extras = [
      { label: "探索派遣", value: expeditions.length ? `${finished} / ${expeditions.length} 完了` : "0件" },
      {
        label: "洞天宝銭",
        value:
          note?.current_home_coin != null ? `${note.current_home_coin} / ${note.max_home_coin}` : "取得不可"
      }
    ];
  } catch (error) {
    out.error = normalizeError(error);
  }
  return out;
}

export async function getZzzStatus(credentials) {
  const uid = credentials.zzzUid;
  const out = baseGame("zzz", "ゼンレスゾーンゼロ", uid, "lime");
  if (!uid) return out;
  try {
    const client = new ZenlessZoneZero({
      cookie: credentials.cookie,
      uid: Number(uid),
      lang: LanguageEnum.JAPANESE
    });
    const [note, checkIn] = await Promise.all([client.record.note(), safeCheckIn(client)]);
    out.authenticated = true;
    out.checkIn = checkIn;

    const current = toNumber(note?.vitality?.current);
    const max = toNumber(note?.vitality?.max);
    out.daily = {
      label: "活躍度",
      current,
      max,
      completed: current !== null && max !== null ? current >= max : null,
      detail:
        current !== null && max !== null
          ? "HoYoLAB活躍度"
          : "HoYoLABの現在の応答では活躍度を判定できません"
    };
    out.resource = {
      label: "バッテリー",
      current: toNumber(note?.energy?.progress?.current),
      max: toNumber(note?.energy?.progress?.max),
      recoverySeconds: toNumber(note?.energy?.restore, 0)
    };
    out.extras = [
      { label: "スクラッチ", value: note?.card_sign ? String(note.card_sign) : "取得不可" },
      {
        label: "ビデオ屋",
        value: note?.vhs_sale?.sale_state ? String(note.vhs_sale.sale_state) : "取得不可"
      }
    ];
  } catch (error) {
    out.error = normalizeError(error);
  }
  return out;
}

export async function getAllGameStatuses(credentials) {
  const games = await Promise.all([
    getHsrStatus(credentials),
    getGenshinStatus(credentials),
    getZzzStatus(credentials)
  ]);
  const configured = games.filter((game) => game.configured);
  return {
    games,
    summary: {
      configured: configured.length,
      completed: configured.filter((game) => game.daily.completed === true).length,
      incomplete: configured.filter((game) => game.daily.completed === false).length,
      unknown: configured.filter((game) => !game.error && game.daily.completed === null).length,
      errors: configured.filter((game) => Boolean(game.error)).length
    }
  };
}
