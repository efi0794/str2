# STR2 — Oracle Database Edition

以前の HoYo Daily Status (str) の画面構成・3ゲームのデイリー管理をベースにした、**Oracle Database 学習課題向けの独立版**です。

**str は変更しません。** このリポジトリ (str2) のみで動作します。

**Windows（Webアプリ）＋Oracle Linux `FREEPDB1` の初回構築／毎回の起動:** [手順書はこちら](docs/setup-from-scratch.md)。以前発生した`ORA-01031`と`ORA-02329`の対応も記載しています。

## 何ができる？

- 原神・崩壊：スターレイル・ゼンレスゾーンゼロの進捗を一覧表示
- タスクの新規登録 (INSERT)、一覧参照 (SELECT)、編集 (UPDATE)、削除 (DELETE)
- 今日の実績 (達成値・メモ) の INSERT / SELECT / UPDATE / DELETE
- 各ゲームのリソース (天然樹脂・開拓力・バッテリー) を手動記録
- **スタミナ使用時間の統計**（時間帯別グラフ、日別推移、手動・推定の区別）
- **スタミナ使用履歴と残量履歴**（期間・ゲーム絞り込み、手動追加、履歴ごとの削除）
- HoYoLABの自動取得値を比較して残量減少を検知し、観測時刻を履歴に記録
- **7つの実表、9つの Oracle VIEW** を使用（スタミナ履歴・統計用テーブルとVIEWを追加）
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
   - sql/06_stamina_history.sql（追加の2テーブル・3VIEW、履歴機能に必須）
   - sql/04_verify.sql（結果確認・任意）

   **既にSTR2のテーブルとVIEWを作成した場合、01〜03を再実行せず、06だけを一度実行してください。**

   **01・02・06は初回のみです。** 同じスキーマで繰り返すとテーブル重複や一意制約エラーになります。

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

## HoYoLAB自動取得

学校PCに置く `.env` の末尾に次の設定項目があります。認証情報と利用するゲームのUIDを、学校PC上でのみ設定してください。

    HOYO_LTOKEN_V2=
    HOYO_LTUID_V2=
    HSR_UID=
    GENSHIN_UID=
    ZZZ_UID=

設定後はサーバーを再起動してください。設定情報はアプリ画面やGitHubに送信しません。

ページを開いたときにHoYoLABを取得し、ブラウザを開いている間は約10分ごとに更新します。取得失敗や判定不能の場合は、その状態を明示し、数値を推測しません。

「HoYoLAB再取得」は画面の情報を更新します。「取得結果をOracleに取り込む」は、確定した数値を既存のタスク実績やリソース記録に保存します。**取り込みは手動操作で、同日の手動実績を上書きする場合があります。**

Oracleに取り込む対象: スターレイルのデイリー訓練、原神のデイリー依頼と追加報酬、ゼンゼロの活躍度、各ゲームのリソース。初期タスクの名前・目標値に一致しない項目は安全のため取り込みません。ログインボーナスと派遣情報は画面表示のみです。

HoYoLABの取得は非公式ライブラリを利用しているため、APIの仕様変更や認証期限切れ、学校ネットワークの制限で利用できない場合があります。使用前にサービスの規約も確認してください。OracleのCRUDはHoYoLABを設定しなくても動作します。

認証情報はGitHub、チャットやスクリーンショットに掲載しないでください。`.env` は `.gitignore` の対象です。

## スタミナ使用時間の統計・履歴

- ページの「スタミナ使用時間の統計・履歴」でゲーム（すべて/個別）と期間（7/30/90/365日）を選ぶと、OracleのVIEWを基に時間帯別・日別の統計と履歴が表示されます。
- **手動記録:** ゲーム・実際に使った日時（JST）・消費量・メモを入力すると、STAMINA_USE_LOGSに記録され、統計に反映されます。
- **自動の推定記録:** HoYoLABの画面取得後、有効なスタミナ残量をHOYO_RESOURCE_SNAPSHOTSへ自動保存します。前回より残量が下がっていて上限値が同じ場合に、減少差分をESTIMATEDとして記録します。
- 自動推定の時刻は**減少を検知した時刻**で、実際に使用した時刻ではありません。自然回復が挟まるため消費量も正確とは限りません。正確な記録が必要なら手動で入力してください。
- ブラウザを閉じている間は自動取得しません。別の日にまた開けば、その時点以降の新しい観測記録が保存されます。
- **削除:** 使用履歴は手動・推定を問わず個別に削除でき、グラフからも消えます。残量履歴のうちOracle記録は個別に削除できます。HoYoLABの観測値は推定の根拠として保持します。
- 既に削除した推定履歴は、同じ観測時刻で画面を再読み込みしても再作成されません。
- 自動観測は日課タスクや手動で入力した実績を上書きしません。従来の「取得結果をOracleに取り込む」は従来通り、確認ボタンを押した場合にのみ別途実行されます。

### 既存STR2からの更新

    cd str2
    git pull
    npm install
    npm run check

**学校のOracleに `sql/06_stamina_history.sql` をSQL DeveloperのF5で1度実行してから `npm start` してください。** 既存テーブルを削除する必要はありません。

### Oracleで確認する

    SELECT * FROM v_stamina_use_history ORDER BY used_at DESC;
    SELECT * FROM v_stamina_hourly_stats ORDER BY game_id, hour_jst;
    SELECT * FROM v_stamina_daily_stats ORDER BY day_jst DESC;

表示が空の場合は手動で1件登録するか、HoYoLABで異なるスタミナ残量の2回以上の観測が必要です。

## 発表での実演例

1. ゲーム別カードが3枚表示される。画面は Oracle VIEW から取得。
2. 「新しいデイリーを追加」でタスクをINSERT。
3. 追加したタスクを「タスク編集」でUPDATE。
4. 「実績登録」で今日の数値をINSERT。
5. 「実績更新」で進捗値を変えて、達成率の変化を確認。
6. 「今日の実績だけ削除」でDELETE。タスクは残る。
7. 「タスク削除」でDELETE (過去の実績も外部キーのON DELETE CASCADEで削除)。
8. SQL Developerで sql/04_verify.sql を実行して 9 VIEW とデータを確認。

デモを毎回リセットしたい場合のみ sql/05_reset_today.sql を確認して実行してください（今日の実績が削除されます）。

## 課題提出物・資料

- docs/design.md — 構成図、ER図、表定義、VIEW解説
- docs/presentation.md — 発表の流れ、CRUD実演、テストケース
- docs/ai-report-template.md — AI利用の INPUT / OUTPUT レポートの記録方法
- sql/01_schema.sql — テーブル定義 (DDL)
- sql/02_seed.sql — サンプルデータ (DML)
- sql/03_views.sql — VIEW定義 (DDL)
- sql/04_verify.sql — SELECT確認 (VIEW/実表)
- sql/06_stamina_history.sql — スタミナ使用履歴・観測スナップショット・3つの追加VIEW

## よくあるエラー

- ORA-01017: Oracleユーザー名・パスワードの誤り
- ORA-12514 / ORA-12154: .env のサービス名・接続文字列を確認
- NJS-503: DBへの接続、Oracleサービス、ポートを確認
- ORA-00942: テーブル/VIEWの未作成、または別ユーザーで作成
- ORA-01031: CREATE TABLE/VIEW の権限不足
- ORA-00955: 01_schema.sql を同じスキーマで再実行
- localhost:3000 が開けない: npm start のエラー、PORTの競合を確認
- 今日の実績が違う日付に見える: SYSDATEはDBサーバー側の日時です

**学校のOracle実機への接続テストは未実施です。** 学校PCで01→02→03を実行し、操作を確認してください。

## セキュリティ

ローカルでの単一ユーザー発表専用です。認証機能や公開運用向けのアクセス制限がないため、HOST を 0.0.0.0 に変更したり、ポートを外部公開したりしないでください。
