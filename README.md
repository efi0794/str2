# STR2 — Oracle Database Edition

以前の HoYo Daily Status (str) の画面構成・3ゲームのデイリー管理をベースにした、**Oracle Database 学習課題向けの独立版**です。

**str は変更しません。** このリポジトリ (str2) のみで動作します。

## 何ができる？

- 原神・崩壊：スターレイル・ゼンレスゾーンゼロの進捗を一覧表示
- タスクの新規登録 (INSERT)、一覧参照 (SELECT)、編集 (UPDATE)、削除 (DELETE)
- 今日の実績 (達成値・メモ) の INSERT / SELECT / UPDATE / DELETE
- 各ゲームのリソース (天然樹脂・開拓力・バッテリー) を手動記録
- **5つの実表、6つの Oracle VIEW** を使用
- A5:SQL Mk-2 / SQL Developer 等で確認できる設計資料とSQL

**重要：** HoYoLABの自動取得を追加しました。画面から最新のゲーム状況を確認できます。Oracle側の手動CRUDも引き続き使用できます。Discord通知とログイン画面はありません。学校PCのlocalhost専用です。

## 必要な環境

- Windowsの学校PC、Node.js 20以降、npm
- Oracle Database 12c以降 (例: Oracle XE 21c)、動作中のDBと接続できるユーザー
- SQL Developer などのOracle用SQL実行ソフト
- インストールするnpmパッケージ: express / oracledb / dotenv / node-hoyolab

ローカルDBの例は XEPDB1 ですが、学校のサービス名が違う場合は読み替えてください。Oracle Thin modeを使用するため、通常はOracle Clientの別途インストールは不要です。

## セットアップ (Windows PowerShell)

1. GitHubから別リポジトリを取得:

~~~~powershell
git clone https://github.com/efi0794/str2.git
cd str2
npm install
~~~~

2. 学校のOracleに接続し、**str2用の空のスキーマ**を使って、SQL Developer等で次のファイルを順に「スクリプト実行 (F5)」してください。Oracleアカウントに CREATE TABLE と CREATE VIEW の権限が必要です。

   - sql/01_schema.sql（5テーブルと索引）
   - sql/02_seed.sql（ゲーム・タスク・サンプル）
   - sql/03_views.sql（6つのVIEW）
   - sql/04_verify.sql（結果確認・任意）

   **01と02は初回のみです。** 同じスキーマで繰り返すとテーブル重複や一意制約エラーになります。

3. 環境変数を設定 (PowerShell):

~~~~powershell
Copy-Item .env.example .env
notepad .env
~~~~

   例: 学校PCでOracleが起動している場合

~~~~dotenv
ORACLE_USER=STR2
ORACLE_PASSWORD=（自分のOracleユーザーのパスワード）
ORACLE_CONNECT_STRING=localhost:1521/XEPDB1
PORT=3000
HOST=127.0.0.1
~~~~

   .env はGitにアップロードしないでください。接続先は学校のDB管理者やSQL Developerの接続設定で確認できます。別のPCのDBに接続する場合は localhost ではありません。

4. 起動:

~~~~powershell
npm run check
npm start
~~~~

5. ブラウザで **http://127.0.0.1:3000** を開いて操作します。接続チェックは http://127.0.0.1:3000/api/health です。

## 発表での実演例

1. ゲーム別カードが3枚表示される。画面は Oracle VIEW から取得。
2. 「新しいデイリーを追加」でタスクをINSERT。
3. 追加したタスクを「タスク編集」でUPDATE。
4. 「実績登録」で今日の数値をINSERT。
5. 「実績更新」で進捗値を変えて、達成率の変化を確認。
6. 「今日の実績だけ削除」でDELETE。タスクは残る。
7. 「タスク削除」でDELETE (過去の実績も外部キーのON DELETE CASCADEで削除)。
8. SQL Developerで sql/04_verify.sql を実行して 6 VIEW とデータを確認。

デモを毎回リセットしたい場合のみ sql/05_reset_today.sql を確認して実行してください（今日の実績が削除されます）。

## 課題提出物・資料

- docs/design.md — 構成図、ER図、表定義、VIEW解説
- docs/presentation.md — 発表の流れ、CRUD実演、テストケース
- docs/ai-report-template.md — AI利用の INPUT / OUTPUT レポートの記録方法
- sql/01_schema.sql — テーブル定義 (DDL)
- sql/02_seed.sql — サンプルデータ (DML)
- sql/03_views.sql — VIEW定義 (DDL)
- sql/04_verify.sql — SELECT確認 (VIEW/実表)

## よくあるエラー

- ORA-01017: Oracleユーザー名・パスワードの誤り
- ORA-12514 / ORA-12154: .env のサービス名・接続文字列を確認
- NJS-503: DBへの接続、Oracleサービス、ポートを確認
- ORA-00942: テーブル/VIEWの未作成、または別ユーザーで作成
- ORA-01031: CREATE TABLE/VIEW の権限不足
- ORA-00955: 01_schema.sql を同じスキーマで再実行
- localhost:3000 が開けない: npm start のエラー、PORTの競合を確認
- 今日の実績が違う日付に見える: SYSDATEはDBサーバー側の日時です

**このChatGPTセッションでは学校のOracleへの接続テストは実施していません。** 学校PCで01→02→03を実行し、操作を確認してください。

## セキュリティ

ローカルでの単一ユーザー発表専用です。認証機能や公開運用向けのアクセス制限がないため、HOST を 0.0.0.0 に変更したり、ポートを外部公開したりしないでください。
