"use strict";

const element = (id) => document.getElementById(id);
const board = element("board");
const notice = element("notice");
const editDialog = element("editDialog");
let state = { games: [], tasks: [], resources: [], today: "" };
let pending = false;

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[char]);
}
function int(value) { return Number(value) || 0; }
function gameClass(value) { return ["blue", "gold", "lime"].includes(value) ? value : "blue"; }
function setNotice(message, type = "") {
  notice.textContent = message;
  notice.className = "notice" + (type ? " " + type : "");
}
async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    cache: "no-store"
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.ok) throw new Error(data.error || "処理に失敗しました。");
  return data;
}
function updateOptions() {
  ["addGame", "editGame"].forEach((id) => {
    const select = element(id);
    const previous = select.value;
    select.innerHTML = state.games.map((game) =>
      '<option value="' + int(game.gameId) + '">' + escapeHtml(game.gameName) + '</option>'
    ).join("");
    if (state.games.some((game) => String(game.gameId) === previous)) select.value = previous;
  });
}
function renderTask(task) {
  const taskId = int(task.taskId);
  const recorded = int(task.hasRecord) === 1;
  const done = int(task.isDone) === 1;
  const progress = int(task.progress);
  const badge = done ? "完了" : recorded ? "進行中" : "未記録";
  return '<div class="task ' + (done ? "done" : "") + '" data-task-id="' + taskId + '">' +
    '<div class="task-name"><strong>' + escapeHtml(task.title) + '</strong><span class="status">' + badge + '</span></div>' +
    '<div class="task-tools">' +
    '<button class="tiny" type="button" data-action="edit-task" data-task-id="' + taskId + '">タスク編集</button>' +
    '<button class="tiny danger" type="button" data-action="delete-task" data-task-id="' + taskId + '">タスク削除</button></div>' +
    '<form class="record-form" data-task-id="' + taskId + '" data-recorded="' + (recorded ? 1 : 0) + '">' +
    '<label>達成値<input name="progress" type="number" min="0" max="9999" value="' + progress + '" required></label>' +
    '<label>メモ<input name="note" type="text" maxlength="200" value="' + escapeHtml(task.note) + '" placeholder="任意"></label>' +
    '<button class="primary" type="submit">' + (recorded ? "実績更新" : "実績登録") + '</button></form>' +
    (recorded ? '<button type="button" class="tiny record-delete" data-action="delete-record" data-task-id="' + taskId + '">今日の実績だけ削除</button>' : '') +
    '</div>';
}
function renderGame(game) {
  const gameId = int(game.gameId);
  const tasks = state.tasks.filter((task) => int(task.gameId) === gameId);
  const resource = state.resources.find((row) => int(row.gameId) === gameId);
  const done = int(game.doneCount);
  const total = int(game.totalCount);
  const percent = Math.min(100, Math.max(0, Number(game.percentDone) || 0));
  const resourceValue = resource ? int(resource.currentAmount) : "--";
  return '<article class="game ' + gameClass(game.accent) + '">' +
    '<div class="game-top"><div><div class="game-code">' + escapeHtml(game.gameCode).toUpperCase() +
    '</div><h2>' + escapeHtml(game.gameName) + '</h2></div><span class="badge">Oracle VIEW</span></div>' +
    '<div class="progress-box"><div class="muted">今日の達成タスク</div>' +
    '<div class="big">' + done + ' / ' + total + '<span> 件完了（' + percent + '%）</span></div>' +
    '<div class="bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + percent +
    '" aria-label="' + escapeHtml(game.gameName) + 'の達成率"><i style="--pct:' + percent + '%"></i></div></div>' +
    '<div class="resource"><div class="resource-head"><span>' + escapeHtml(game.resourceLabel) + '</span>' +
    '<strong>' + resourceValue + ' <small>/ ' + int(game.resourceMax) + '</small></strong></div>' +
    '<form class="resource-form" data-game-id="' + gameId + '">' +
    '<input name="currentAmount" type="number" aria-label="' + escapeHtml(game.resourceLabel) + 'の現在値" min="0" max="' +
    int(game.resourceMax) + '" value="' + (resource ? int(resource.currentAmount) : 0) + '" required>' +
    '<button type="submit">リソース記録</button></form></div>' +
    '<div class="task-title-row"><h3>デイリー管理</h3><span class="task-count">' + tasks.length + 'タスク</span></div>' +
    '<div class="task-list">' + (tasks.length ? tasks.map(renderTask).join("") :
    '<div class="empty">タスクがありません。下のフォームで追加してください。</div>') + '</div></article>';
}
function render() {
  element("today").textContent = state.today;
  const total = state.tasks.length;
  const done = state.tasks.filter((task) => int(task.isDone) === 1).length;
  element("total").textContent = total;
  element("done").textContent = done;
  element("left").textContent = total - done;
  board.innerHTML = state.games.map(renderGame).join("");
  updateOptions();
}
async function reload(message) {
  const data = await api("/api/dashboard");
  state = { games: data.games, tasks: data.tasks, resources: data.resources, today: data.today };
  render();
  setNotice(message || "Oracle Databaseから今日の最新データを取得しました。", "success");
}
async function operation(task) {
  if (pending) return;
  pending = true;
  const buttons = document.querySelectorAll("button");
  buttons.forEach((button) => button.disabled = true);
  try {
    const message = await task();
    await reload(message);
  } catch (error) {
    setNotice(error.message, "error");
  } finally {
    pending = false;
    document.querySelectorAll("button").forEach((button) => button.disabled = false);
  }
}

element("reloadButton").addEventListener("click", () => operation(async () => "最新状態に更新しました。"));
element("addTaskForm").addEventListener("submit", (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  operation(async () => {
    const payload = Object.fromEntries(new FormData(form));
    const result = await api("/api/tasks", { method: "POST", body: JSON.stringify(payload) });
    form.elements.title.value = "";
    form.elements.targetCount.value = "1";
    return result.message;
  });
});
board.addEventListener("submit", (event) => {
  const form = event.target;
  if (form.matches(".record-form")) {
    event.preventDefault();
    operation(async () => {
      const taskId = int(form.dataset.taskId);
      const recorded = form.dataset.recorded === "1";
      const payload = Object.fromEntries(new FormData(form));
      if (!recorded) payload.taskId = taskId;
      const result = await api(recorded ? "/api/records/" + taskId : "/api/records", {
        method: recorded ? "PUT" : "POST",
        body: JSON.stringify(payload)
      });
      return result.message;
    });
  } else if (form.matches(".resource-form")) {
    event.preventDefault();
    operation(async () => {
      const payload = Object.fromEntries(new FormData(form));
      payload.gameId = int(form.dataset.gameId);
      const result = await api("/api/resources", { method: "POST", body: JSON.stringify(payload) });
      return result.message;
    });
  }
});
board.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-action]");
  if (!button || pending) return;
  const taskId = int(button.dataset.taskId);
  const task = state.tasks.find((row) => int(row.taskId) === taskId);
  if (!task) return;
  if (button.dataset.action === "edit-task") {
    element("editTaskId").value = taskId;
    element("editGame").value = task.gameId;
    element("editTitle").value = task.title;
    element("editTarget").value = task.targetCount;
    editDialog.showModal();
  }
  if (button.dataset.action === "delete-task") {
    if (!window.confirm("「" + task.title + "」を削除しますか？過去の実績も削除されます。")) return;
    operation(async () => {
      const result = await api("/api/tasks/" + taskId, { method: "DELETE" });
      return result.message;
    });
  }
  if (button.dataset.action === "delete-record") {
    if (!window.confirm("今日の「" + task.title + "」の実績を削除しますか？")) return;
    operation(async () => {
      const result = await api("/api/records/" + taskId, { method: "DELETE" });
      return result.message;
    });
  }
});
element("closeEdit").addEventListener("click", () => editDialog.close());
element("editTaskForm").addEventListener("submit", (event) => {
  event.preventDefault();
  operation(async () => {
    const payload = Object.fromEntries(new FormData(event.currentTarget));
    const taskId = int(payload.taskId);
    delete payload.taskId;
    const result = await api("/api/tasks/" + taskId, { method: "PUT", body: JSON.stringify(payload) });
    editDialog.close();
    return result.message;
  });
});

reload().catch((error) => {
  setNotice("起動に失敗しました：" + error.message + "　SQL(01→02→03)と.envを確認してください。", "error");
});
