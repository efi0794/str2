"use strict";

// スタミナ履歴・統計画面。HoYoLABの自動観測と手動記録を混同しない。
(() => {
  const root = document.getElementById("staminaPanel");
  if (!root) return;
  const byId = id => document.getElementById(id);
  const gameNames = { 1: "崩壊：スターレイル", 2: "原神", 3: "ゼンレスゾーンゼロ" };
  let lastData = null;
  let busy = false;
  const esc = value => String(value ?? "").replace(/[&<>"']/g, ch => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[ch]));
  const num = value => Math.max(0, Number(value) || 0);
  const numberLabel = value => num(value).toLocaleString("ja-JP");
  const setMessage = (message, error = false) => {
    const target = byId("staminaMessage");
    target.textContent = message;
    target.className = "stamina-notice" + (error ? " error" : "");
  };
  async function request(url, options) {
    const response = await fetch(url, {
      cache: "no-store", ...options,
      headers: { "Content-Type": "application/json", ...(options?.headers || {}) }
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.ok) throw new Error(data.error || "Oracleの処理に失敗しました。");
    return data;
  }
  const currentFilter = () => ({
    gameId: Number(byId("staminaGameFilter").value),
    days: Number(byId("staminaDaysFilter").value)
  });

  function renderSummary(data) {
    const m = data.summary.find(x => x.source === "MANUAL");
    const e = data.summary.find(x => x.source === "ESTIMATED");
    const manual = num(m?.totalAmount), estimated = num(e?.totalAmount);
    byId("staminaSummary").innerHTML = [
      ["手動記録の消費量", numberLabel(manual), "手入力した時刻・量"],
      ["減少から推定した量", numberLabel(estimated), "観測時の減少差分"],
      ["合計記録件数", numberLabel(num(m?.eventCount) + num(e?.eventCount)), "手動と推定を合わせた件数"]
    ].map(([label, value, detail]) => '<div class="stat-tile"><small>' + esc(label) +
      '</small><strong>' + esc(value) + '</strong><small>' + esc(detail) + '</small></div>').join("");
  }
  function renderHours(rows) {
    const hours = Array.from({ length: 24 }, (_, hour) => {
      const atHour = rows.filter(row => Number(row.hourJst) === hour);
      return {
        hour,
        manual: num(atHour.find(row => row.source === "MANUAL")?.totalAmount),
        estimated: num(atHour.find(row => row.source === "ESTIMATED")?.totalAmount)
      };
    });
    const peak = Math.max(1, ...hours.map(h => h.manual + h.estimated));
    byId("staminaHours").innerHTML = hours.map(h => {
      const manHeight = h.manual / peak * 100;
      const estHeight = h.estimated / peak * 100;
      return '<div class="hour-col" title="' + h.hour + '時: 手動' + h.manual + '/推定' + h.estimated + '">' +
        '<div class="hour-height"><div class="hour-bar" style="height:' +
        ((h.manual + h.estimated) / peak * 100).toFixed(2) + '%">' +
        '<div class="segment-estimated" style="height:' + (estHeight / Math.max(.001, manHeight + estHeight) * 100).toFixed(2) + '%"></div>' +
        '<div class="segment-manual" style="height:' + (manHeight / Math.max(.001, manHeight + estHeight) * 100).toFixed(2) + '%"></div>' +
        '</div></div><span class="hour-label">' + h.hour + '</span></div>';
    }).join("");
  }
  function renderDays(data) {
    const todayJst = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
    const dayCount = Math.min(14, data.filters.days);
    const rows = [];
    for (let i = dayCount - 1; i >= 0; i--) {
      const d = new Date(todayJst + "T00:00:00.000Z");
      d.setUTCDate(d.getUTCDate() - i);
      const day = d.toISOString().slice(0, 10);
      const sources = data.daily.filter(row => row.dayJst === day);
      rows.push({
        day,
        manual: num(sources.find(x => x.source === "MANUAL")?.totalAmount),
        estimated: num(sources.find(x => x.source === "ESTIMATED")?.totalAmount)
      });
    }
    const peak = Math.max(1, ...rows.map(r => r.manual + r.estimated));
    byId("staminaDaily").innerHTML = rows.map(row =>
      '<div class="usage-day"><span>' + row.day.slice(5).replace("-", "/") + '</span>' +
      '<div class="day-track"><i class="manual" style="width:' + (row.manual / peak * 100).toFixed(2) + '%"></i>' +
      '<i class="estimated" style="width:' + (row.estimated / peak * 100).toFixed(2) + '%"></i></div>' +
      '<span class="day-amount">' + numberLabel(row.manual + row.estimated) + '</span></div>'
    ).join("");
  }
  function renderUsageHistory(history) {
    const target = byId("staminaHistory");
    if (!history.length) { target.innerHTML = '<tr><td colspan="6" class="stamina-empty">この期間の使用履歴はありません。</td></tr>'; return; }
    target.innerHTML = history.map(record => {
      const kind = record.source === "MANUAL" ? "手動" : "推定";
      return '<tr><td>' + esc(record.usedAtJst) + '</td>' +
        '<td>' + esc(record.gameName) + '</td>' +
        '<td><strong>' + numberLabel(record.amount) + '</strong></td>' +
        '<td><span class="stamina-kind ' + (record.source === "ESTIMATED" ? "estimate" : "") + '">' + kind + '</span></td>' +
        '<td>' + esc(record.note || "") + '</td>' +
        '<td><button class="tiny danger" data-delete-stamina="' + Number(record.useId) + '" type="button">削除</button></td></tr>';
    }).join("");
  }
  function renderResourceHistory(history) {
    const target = byId("staminaResourceHistory");
    if (!history.length) { target.innerHTML = '<tr><td colspan="6" class="stamina-empty">この期間の残量記録はありません。</td></tr>'; return; }
    target.innerHTML = history.map(record => {
      const isOracle = record.source === "ORACLE";
      return '<tr><td>' + esc(record.observedAtJst) + '</td>' +
        '<td>' + esc(record.gameName) + '</td>' +
        '<td>' + numberLabel(record.currentAmount) + ' / ' + numberLabel(record.maxAmount) + '</td>' +
        '<td><span class="stamina-kind ' + (isOracle ? "" : "hoyo") + '">' +
        (isOracle ? "Oracle記録" : "HoYoLAB観測") + '</span></td>' +
        '<td>' + (isOracle ? '<button class="tiny danger" data-delete-resource="' + Number(record.entryId) +
          '" type="button">削除</button>' : '<span class="stamina-caption">観測記録</span>') + '</td></tr>';
    }).join("");
  }
  async function refresh(message) {
    if (busy) return;
    busy = true;
    byId("staminaRefresh").disabled = true;
    try {
      const { gameId, days } = currentFilter();
      const data = await request("/api/stamina/analytics?gameId=" + gameId + "&days=" + days);
      lastData = data;
      renderSummary(data);
      renderHours(data.hours);
      renderDays(data);
      renderUsageHistory(data.history);
      renderResourceHistory(data.resourceHistory);
      setMessage(message || "直近" + days + "日間の統計です。履歴は各100件まで表示します。時間帯は日本時間（JST）です。");
    } catch (error) {
      setMessage(error.message + "　既存環境では sql/06_stamina_history.sql の初回実行が必要です。", true);
    } finally {
      busy = false;
      byId("staminaRefresh").disabled = false;
    }
  }
  function japanNow() {
    return new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 16);
  }
  byId("staminaUsedAt").value = japanNow();
  byId("staminaGameFilter").addEventListener("change", () => refresh());
  byId("staminaDaysFilter").addEventListener("change", () => refresh());
  byId("staminaRefresh").addEventListener("click", () => refresh());
  byId("staminaUseForm").addEventListener("submit", async event => {
    event.preventDefault();
    if (busy) return;
    const form = event.currentTarget;
    busy = true;
    try {
      const payload = Object.fromEntries(new FormData(form));
      const result = await request("/api/stamina/use", { method: "POST", body: JSON.stringify(payload) });
      form.elements.amount.value = "";
      form.elements.note.value = "";
      await Promise.resolve();
      busy = false;
      await refresh(result.message);
    } catch (error) {
      busy = false;
      setMessage(error.message, true);
    }
  });
  root.addEventListener("click", async event => {
    const btn = event.target.closest("button[data-delete-stamina],button[data-delete-resource]");
    if (!btn || busy) return;
    const useId = btn.dataset.deleteStamina;
    const resourceId = btn.dataset.deleteResource;
    const isUse = useId !== undefined;
    if (!confirm(isUse
      ? "このスタミナ使用履歴を削除しますか？統計からも除外されます。"
      : "このOracleリソース履歴を削除しますか？")) return;
    busy = true;
    try {
      const result = await request(isUse ? "/api/stamina/use/" + encodeURIComponent(useId) :
        "/api/resources/" + encodeURIComponent(resourceId), { method: "DELETE" });
      busy = false;
      await refresh(result.message);
    } catch (error) {
      busy = false;
      setMessage(error.message, true);
    }
  });
  window.addEventListener("stamina-updated", () => refresh());
  refresh();
})();
