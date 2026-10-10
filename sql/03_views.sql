-- 課題要件：VIEWを5個以上。STR2では計6個を作成。
SET DEFINE OFF

-- 1. ゲームとタスクのマスタ一覧 (JOIN)
CREATE OR REPLACE VIEW v_task_catalog AS
SELECT t.task_id, t.game_id, g.game_code, g.game_name,
       t.title, t.target_count, t.sort_order, t.is_active
FROM daily_tasks t
JOIN games g ON g.game_id = t.game_id;

-- 2. 今日のタスク・実績一覧 (LEFT JOIN / NVL / CASE)
CREATE OR REPLACE VIEW v_daily_task_status AS
SELECT u.user_id, u.display_name, g.game_id, g.game_code, g.game_name,
       g.accent, g.resource_label, g.resource_max,
       t.task_id, t.title, t.target_count, t.sort_order,
       NVL(r.progress, 0) AS progress, NVL(r.note, '') AS note,
       CASE WHEN r.record_id IS NULL THEN 0 ELSE 1 END AS has_record,
       CASE WHEN NVL(r.progress, 0) >= t.target_count THEN 1 ELSE 0 END AS is_done
FROM users u
CROSS JOIN games g
JOIN daily_tasks t ON t.game_id = g.game_id AND t.is_active = 1
LEFT JOIN task_records r
  ON r.user_id = u.user_id
 AND r.task_id = t.task_id
 AND r.record_date = TRUNC(SYSDATE);

-- 3. ゲーム別完了数と進捗率 (集計・結合)
CREATE OR REPLACE VIEW v_game_progress AS
SELECT u.user_id, g.game_id, g.game_code, g.game_name, g.accent,
       g.resource_label, g.resource_max,
       COUNT(s.task_id) AS total_count,
       NVL(SUM(s.is_done), 0) AS done_count,
       CASE WHEN COUNT(s.task_id) = 0 THEN 0
            ELSE ROUND(100 * NVL(SUM(s.is_done), 0) / COUNT(s.task_id), 1)
       END AS percent_done
FROM users u
CROSS JOIN games g
LEFT JOIN v_daily_task_status s
  ON s.user_id = u.user_id AND s.game_id = g.game_id
GROUP BY u.user_id, g.game_id, g.game_code, g.game_name, g.accent,
         g.resource_label, g.resource_max;

-- 4. 未達成タスク
CREATE OR REPLACE VIEW v_unfinished_tasks AS
SELECT * FROM v_daily_task_status WHERE is_done = 0;

-- 5. 達成済みタスク
CREATE OR REPLACE VIEW v_completed_tasks AS
SELECT * FROM v_daily_task_status WHERE is_done = 1;

-- 6. ゲーム別の最新リソース (分析関数 ROW_NUMBER)
CREATE OR REPLACE VIEW v_latest_resources AS
SELECT user_id, game_id, current_amount, max_amount, measured_at
FROM (
  SELECT r.user_id, r.game_id, r.current_amount, r.max_amount,
         TO_CHAR(r.measured_at, 'YYYY-MM-DD HH24:MI:SS') AS measured_at,
         ROW_NUMBER() OVER (
           PARTITION BY r.user_id, r.game_id
           ORDER BY r.measured_at DESC, r.resource_id DESC
         ) AS rn
  FROM resource_logs r
)
WHERE rn = 1;

PROMPT 03_views.sql completed
