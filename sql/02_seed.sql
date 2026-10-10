-- 01_schema.sql の後に一度だけ実行する
SET DEFINE OFF
INSERT INTO users (user_id, display_name) VALUES (1, '発表用ユーザー');

INSERT INTO games (game_id, game_code, game_name, accent, resource_label, resource_max)
  VALUES (1, 'hsr', '崩壊：スターレイル', 'blue', '開拓力', 300);
INSERT INTO games (game_id, game_code, game_name, accent, resource_label, resource_max)
  VALUES (2, 'genshin', '原神', 'gold', '天然樹脂', 200);
INSERT INTO games (game_id, game_code, game_name, accent, resource_label, resource_max)
  VALUES (3, 'zzz', 'ゼンレスゾーンゼロ', 'lime', 'バッテリー', 240);

INSERT INTO daily_tasks (game_id, title, target_count, sort_order) VALUES (1, 'デイリー訓練', 500, 10);
INSERT INTO daily_tasks (game_id, title, target_count, sort_order) VALUES (1, '依頼報酬の受取', 1, 20);
INSERT INTO daily_tasks (game_id, title, target_count, sort_order) VALUES (1, '派遣の確認', 1, 30);
INSERT INTO daily_tasks (game_id, title, target_count, sort_order) VALUES (2, 'デイリー依頼', 4, 10);
INSERT INTO daily_tasks (game_id, title, target_count, sort_order) VALUES (2, '追加報酬の受取', 1, 20);
INSERT INTO daily_tasks (game_id, title, target_count, sort_order) VALUES (2, '探索派遣の確認', 1, 30);
INSERT INTO daily_tasks (game_id, title, target_count, sort_order) VALUES (3, '活躍度', 400, 10);
INSERT INTO daily_tasks (game_id, title, target_count, sort_order) VALUES (3, 'ビデオ屋の営業', 1, 20);
INSERT INTO daily_tasks (game_id, title, target_count, sort_order) VALUES (3, 'スクラッチ', 1, 30);

INSERT INTO task_records (user_id, task_id, record_date, progress, note)
SELECT 1, task_id, TRUNC(SYSDATE), 4, '発表用サンプルデータ'
  FROM daily_tasks WHERE game_id = 2 AND title = 'デイリー依頼';
INSERT INTO task_records (user_id, task_id, record_date, progress, note)
SELECT 1, task_id, TRUNC(SYSDATE), 200, '途中経過'
  FROM daily_tasks WHERE game_id = 1 AND title = 'デイリー訓練';

INSERT INTO resource_logs (user_id, game_id, current_amount, max_amount)
  VALUES (1, 1, 140, 300);
INSERT INTO resource_logs (user_id, game_id, current_amount, max_amount)
  VALUES (1, 2, 85, 200);
INSERT INTO resource_logs (user_id, game_id, current_amount, max_amount)
  VALUES (1, 3, 110, 240);
COMMIT;
PROMPT 02_seed.sql completed
