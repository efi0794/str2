-- 提出用SQL動作確認。SQL Developerのスクリプト実行(F5)推奨
SET LINESIZE 180
SET PAGESIZE 100
COLUMN view_name FORMAT A30
SELECT view_name FROM user_views WHERE view_name LIKE 'V_%' ORDER BY view_name;
SELECT COUNT(*) AS table_count FROM user_tables
 WHERE table_name IN ('USERS','GAMES','DAILY_TASKS','TASK_RECORDS','RESOURCE_LOGS');
SELECT * FROM v_task_catalog ORDER BY game_id, sort_order;
SELECT * FROM v_daily_task_status WHERE user_id = 1 ORDER BY game_id, sort_order;
SELECT * FROM v_game_progress WHERE user_id = 1 ORDER BY game_id;
SELECT * FROM v_unfinished_tasks WHERE user_id = 1 ORDER BY game_id;
SELECT * FROM v_completed_tasks WHERE user_id = 1 ORDER BY game_id;
SELECT * FROM v_latest_resources WHERE user_id = 1 ORDER BY game_id;
-- Web側のCRUDを試した後、実表も確認:
SELECT * FROM daily_tasks ORDER BY game_id, task_id;
SELECT * FROM task_records ORDER BY record_id;
SELECT * FROM resource_logs ORDER BY resource_id;

-- sql/06_stamina_history.sql 適用後の統計・履歴
SELECT * FROM v_stamina_use_history ORDER BY used_at DESC FETCH FIRST 30 ROWS ONLY;
SELECT * FROM v_stamina_hourly_stats ORDER BY game_id, hour_jst;
SELECT * FROM v_stamina_daily_stats ORDER BY day_jst DESC, game_id;
SELECT * FROM hoyo_resource_snapshots ORDER BY observed_at DESC FETCH FIRST 30 ROWS ONLY;
