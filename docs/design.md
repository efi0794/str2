# STR2 — 設計資料

## 目的と技術選定
既存strの「3ゲームの日課を1画面で見る」体験を残し、SQL学習課題のOracle Database連携・CRUD・VIEWを実装する。
- 画面: HTML / CSS / JavaScript (既存strに近いダークUI)
- Webサーバー: Node.js 20+ / Express
- HoYoLAB取得: node-hoyolab (非公式ライブラリ、認証情報はローカル環境変数からのみ読み込み)
- DBドライバー: node-oracledb Thin mode
- DB: Oracle Database 12c以上 (学校の環境)
- 配置: 学校PCのlocalhost (1人用デモ)

## システム構成図

~~~~mermaid
flowchart TD
    B[ブラウザ<br/>HTML/CSS/JavaScript]
    E[Express Webサーバー<br/>127.0.0.1:3000]
    D[node-oracledb<br/>SQLバインド変数]
    O[(Oracle Database<br/>5実表 / 6 VIEW)]
    B -->|HTTP / JSON| E
    E --> D
    D -->|SQL SELECT / INSERT / UPDATE / DELETE| O
    O -->|結果行| D
    H[HoYoLAB / 外部API] -->|最新ステータス| E
~~~~

- Oracleとは別にHoYoLABから取得した最新情報を画面に表示する。Cloudflareは使用しない。
- HoYoLABは表示時・約10分おきに再取得し、サーバーで短時間キャッシュする。
- SQLのJOIN、集計、CASE、NVL、ROW_NUMBERなどのロジックはVIEW側へ集約する。
- ExpressはVIEWからSELECTし、登録・更新・削除だけ実表へSQLを発行する。

## E-R図

~~~~mermaid
erDiagram
    USERS ||--o{ TASK_RECORDS : records
    USERS ||--o{ RESOURCE_LOGS : saves
    GAMES ||--o{ DAILY_TASKS : contains
    GAMES ||--o{ RESOURCE_LOGS : measures
    DAILY_TASKS ||--o{ TASK_RECORDS : tracks
    USERS {
      NUMBER user_id PK
      VARCHAR2 display_name
    }
    GAMES {
      NUMBER game_id PK
      VARCHAR2 game_code UK
      VARCHAR2 game_name
      VARCHAR2 accent
      VARCHAR2 resource_label
      NUMBER resource_max
    }
    DAILY_TASKS {
      NUMBER task_id PK
      NUMBER game_id FK
      VARCHAR2 title
      NUMBER target_count
      NUMBER sort_order
      NUMBER is_active
    }
    TASK_RECORDS {
      NUMBER record_id PK
      NUMBER user_id FK
      NUMBER task_id FK
      DATE record_date
      NUMBER progress
      VARCHAR2 note
      TIMESTAMP updated_at
    }
    RESOURCE_LOGS {
      NUMBER resource_id PK
      NUMBER user_id FK
      NUMBER game_id FK
      NUMBER current_amount
      NUMBER max_amount
      TIMESTAMP measured_at
    }
~~~~

## テーブル定義書（抜粋）

| テーブル | 主キー | 主なカラムと型 | 役割 |
|---|---|---|---|
| USERS | USER_ID NUMBER(10) | DISPLAY_NAME VARCHAR2(80 CHAR) | ローカル発表ユーザー |
| GAMES | GAME_ID NUMBER(10) | GAME_CODE VARCHAR2(20 CHAR), GAME_NAME VARCHAR2(80 CHAR), ACCENT VARCHAR2(10 CHAR), RESOURCE_LABEL VARCHAR2(30 CHAR), RESOURCE_MAX NUMBER(8) | ゲームマスタ |
| DAILY_TASKS | TASK_ID NUMBER IDENTITY | GAME_ID NUMBER FK, TITLE VARCHAR2(80 CHAR), TARGET_COUNT NUMBER(8), SORT_ORDER NUMBER(5), IS_ACTIVE NUMBER(1) | タスクマスタ |
| TASK_RECORDS | RECORD_ID NUMBER IDENTITY | USER_ID NUMBER FK, TASK_ID NUMBER FK, RECORD_DATE DATE, PROGRESS NUMBER(8), NOTE VARCHAR2(200 CHAR), UPDATED_AT TIMESTAMP | 今日のタスク実績 |
| RESOURCE_LOGS | RESOURCE_ID NUMBER IDENTITY | USER_ID NUMBER FK, GAME_ID NUMBER FK, CURRENT_AMOUNT NUMBER(8), MAX_AMOUNT NUMBER(8), MEASURED_AT TIMESTAMP | スタミナ等の推移 |

追加制約: TASK_RECORDS は (USER_ID, TASK_ID, RECORD_DATE) の組合せをUNIQUEにし、同じ日の二重登録を防止。RECORD_DATEは日付の0時を保存。TASK_RECORDS→DAILY_TASKSには ON DELETE CASCADE。RESOURCE_LOGSは現在値が最大値以下となるCHECK制約付き。詳細なDEFAULT・制約・索引は sql/01_schema.sql が正式定義。

## VIEW定義の用途

| VIEW | 使用技術 | 用途 |
|---|---|---|
| V_TASK_CATALOG | INNER JOIN | ゲーム名付きタスク一覧 |
| V_DAILY_TASK_STATUS | CROSS JOIN / LEFT JOIN / NVL / CASE | 未記録を含めた今日のタスク状況 |
| V_GAME_PROGRESS | GROUP BY / COUNT / SUM / ROUND | ゲーム別の進捗・完了率 |
| V_UNFINISHED_TASKS | WHERE 条件付きVIEW | 未達成の抽出 |
| V_COMPLETED_TASKS | WHERE 条件付きVIEW | 完了したものの抽出 |
| V_LATEST_RESOURCES | ROW_NUMBER分析関数 | ゲーム別最新のリソース値 |

Web画面では V_GAME_PROGRESS・V_DAILY_TASK_STATUS・V_LATEST_RESOURCES を参照する。
その他の3 VIEWは sql/04_verify.sql で確認できる。

## CRUDとエンドポイント

| HTTP | API | SQL種別 | 対象 |
|---|---|---|---|
| GET | /api/dashboard | SELECT | 3つのVIEW |
| POST | /api/tasks | INSERT | DAILY_TASKS |
| PUT | /api/tasks/:taskId | UPDATE | DAILY_TASKS |
| DELETE | /api/tasks/:taskId | DELETE | DAILY_TASKS |
| POST | /api/records | INSERT | TASK_RECORDS |
| PUT | /api/records/:taskId | UPDATE | TASK_RECORDS |
| DELETE | /api/records/:taskId | DELETE | TASK_RECORDS |
| POST | /api/resources | INSERT | RESOURCE_LOGS |
| GET | /api/hoyo/status | 外部API取得 | Oracleを書き換えずに最新ステータスを返す |
| POST | /api/hoyo/sync | MERGE / INSERT / UPDATE | 取得に成功した数値を実表へ取り込む |

SQL値はバインド変数で渡し、文字列連結SQLを避ける。更新系はデータベースCOMMIT後に結果を返す。

## 今回の制約
- 発表用のため、ログインはなくユーザーID=1に固定。
- Oracleが起動していないPCではバックエンドのAPIが動作しない。
- HoYoLABの自動取得・取得データのOracle取り込みは実装。Discord通知はなし。
- 最新ステータスはデータベースの SYSDATE を基準に当日表示する。
- 一般公開や他人への利用提供には別途認証・アクセス権限の実装が必要。

## HoYoLAB自動取得の方針
- CookieとUIDはローカルの.envにのみ設定し、OracleやブラウザへCookieそのものは渡さない。
- Oracleへの転記は明示的な操作時のみ。手動実績を上書きする場合があることを確認ダイアログで通知する。
- 不明なAPI値を0として記録しない。ゲーム名・タスク名・目標値が一致しないデータは取り込まない。
- サーバーの5分キャッシュ、強制再取得の最低1分間隔でリクエストを減らす。
- HoYoLABが使えない場合もOracleのCRUDデモは利用できる。
