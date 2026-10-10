-- 注意: 本当に今日の実績を消してよい場合だけ実行してください。
-- 発表準備用。タスクマスタと過去日のデータは消しません。
DELETE FROM task_records
WHERE user_id = 1 AND record_date = TRUNC(SYSDATE);
COMMIT;
SELECT COUNT(*) AS today_records FROM task_records
WHERE user_id = 1 AND record_date = TRUNC(SYSDATE);
