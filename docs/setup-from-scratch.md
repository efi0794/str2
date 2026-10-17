# STR2 — Windows + Oracle Linux (FREEPDB1) 初回セットアップ／起動手順

この手順は **WindowsでSTR2（Node.jsとWeb画面）を動かし、Oracle Linux仮想マシン上のOracle Database 23ai Freeに接続する** 環境向けです。元の `str` には変更を加えません。

## 0. 構成・機能

- Windows: ブラウザ、Node.js 20以降、PowerShell、Git、必要ならSQL Developer
- Oracle Linux: Oracle Database 23ai Free、PDB `FREEPDB1`、接続ユーザー `STR2`
- 接続先（この環境で使っていた値）: `192.168.56.101:1521/FREEPDB1`。VMのIPが変わっていたら読み替える
- STR2: HoYoLAB自動取得、日課CRUD、スタミナ使用時間帯別・日別の統計、手動・推定履歴、個別削除
- スタミナの「推定」は**実際の使用時刻ではなく、残量の減少を観測した時刻**。自然回復を挟むと消費量も一致しない

## 1. WindowsにSTR2を取得

PowerShellを開いて、まだ取得していない場合:

```powershell
cd "$HOME\Documents"
git clone https://github.com/efi0794/str2.git
cd str2
npm install
```

すでに `str2` を取得済みの場合は、`str2` フォルダで:

```powershell
git pull
npm install
```

Gitが使えない場合はGitHubの Code → Download ZIP → 展開し、展開したフォルダで `npm install`。Git・Node.js・npmが未導入の場合は先にインストールが必要。

## 2. Oracle Linuxの稼働・リスナーを確認

Oracle Linuxを起動し、Linuxターミナルで `lsnrctl services` を確認。**`FREEPDB1` が `READY`** なら次へ進む。リスナーが起動していても `The listener supports no services` なら、DBからのサービス登録が必要。

このVMでは、以前ホスト名がVMのIPでないアドレスに解決されていたため、管理者が `listener.ora` を `192.168.56.101:1521` に修正し、Oracleの `LOCAL_LISTENER` を一時設定した。**Oracle再起動後は `SCOPE=MEMORY` の一時設定が消える**可能性がある。自分が管理するVMで許可がある場合のみ、SYSDBAで以下を確認する:

```bash
sqlplus / as sysdba
```

```sql
SHOW PDBS;
SHOW PARAMETER LOCAL_LISTENER;
ALTER SYSTEM SET LOCAL_LISTENER = '(ADDRESS=(PROTOCOL=TCP)(HOST=192.168.56.101)(PORT=1521))' SCOPE=MEMORY;
ALTER SYSTEM REGISTER;
EXIT;
```

```bash
lsnrctl services
```

**学校共有サーバーならリスナーやシステム設定は勝手に変更せず、管理者へ確認すること。** `FREEPDB1` が `READ WRITE` かつリスナー側で `READY` になればよい。

Windows側PowerShellから接続を確認:

```powershell
Test-NetConnection 192.168.56.101 -Port 1521
```

`TcpTestSucceeded : True` になればWindowsからポートに到達できる。

## 3. STR2ユーザーの接続権限を確認

SQL Developerで以下を設定する:

| 項目 | 値 |
|---|---|
| ユーザー名 | `STR2` |
| パスワード | OracleのSTR2ユーザーに設定したパスワード |
| ホスト名 | `192.168.56.101` |
| ポート | `1521` |
| 接続タイプ | Basic |
| サービス名 | `FREEPDB1` |

テスト成功後に接続し、新しいSQLワークシートで以下を確認:

```sql
SELECT USER, SYS_CONTEXT('USERENV', 'CON_NAME') AS PDB FROM dual;
```

`STR2` / `FREEPDB1` の接続でDDLを実行する。**`SYS` や `CDB$ROOT` ではSTR2のテーブルを作成しない。**

空のSTR2ユーザーが存在しない場合はDB管理者に作成を依頼する。Oracle 23ai FreeではIDENTITY列を使うため、STR2には `CREATE SESSION`、`CREATE TABLE`、`CREATE VIEW`、`CREATE SEQUENCE` と対象表領域のQUOTAが必要。管理者に許可を得てFREEPDB1で実行するGRANTの例:

```sql
GRANT CREATE SESSION, CREATE TABLE, CREATE VIEW, CREATE SEQUENCE TO STR2;
```

## 4. SQLを実行（新規・既存で分岐）

SQL Developerのファイル→開くからWindows上の `str2/sql/` 内のファイルを開き、**STR2接続を選んでF5（スクリプト実行）**。PowerShellやVS CodeのターミナルにSQLを貼るのではなく、Oracleへ接続したSQL Developerで実行する。

### 4-A. STR2スキーマが空の場合（初回）

| 順番 | ファイル | 処理 |
|---|---|---|
| 1 | `sql/01_schema.sql` | 既存の基本5テーブルとインデックス |
| 2 | `sql/02_seed.sql` | 3ゲーム・デイリーのサンプルデータ |
| 3 | `sql/03_views.sql` | 基本6VIEW |
| 4 | `sql/06_stamina_history.sql` | 追加2テーブル・スタミナ統計用3VIEW |
| 5 | `sql/04_verify.sql` | 出力確認 |

**特に06は前に起きた `ORA-02329` の修正版をGitHubから更新して使うこと。** 更新後の `HOYO_RESOURCE_SNAPSHOTS` には `OBSERVED_AT_KEY` 列があり、日時キーを文字列として一意に管理する。

### 4-B. 途中まで作成済み・前に失敗した場合

先に以下を実行:

```sql
SELECT table_name FROM user_tables ORDER BY table_name;
SELECT view_name FROM user_views ORDER BY view_name;
SELECT COUNT(*) AS game_count FROM games;
```

- 基本5テーブルがある場合、**01は再実行しない**。
- GAMESが3件登録済みなら、**02は再実行しない**（重複・一意制約違反を避ける）。
- 03はCREATE OR REPLACE VIEWなので、基本6VIEWが不足していれば実行できる。
- 追加2テーブルが**両方ともない**なら、06を最初から1回実行する。
- 追加テーブルが**片方だけ存在する**なら、06を最初から再実行せず、そのテーブルを作るSQLを除き、足りないテーブル、索引、VIEWを個別に実行する。データは削除しない。
- 06の末尾の `PROMPT ... reached end` は成功保証ではない。途中にエラーがないことを確認する。

現在のオブジェクト状況を厳密に確認するSQL:

```sql
SELECT object_name, object_type, status FROM user_objects
WHERE object_name IN (
  'USERS','GAMES','DAILY_TASKS','TASK_RECORDS','RESOURCE_LOGS',
  'HOYO_RESOURCE_SNAPSHOTS','STAMINA_USE_LOGS',
  'V_TASK_CATALOG','V_DAILY_TASK_STATUS','V_GAME_PROGRESS',
  'V_UNFINISHED_TASKS','V_COMPLETED_TASKS','V_LATEST_RESOURCES',
  'V_STAMINA_USE_HISTORY','V_STAMINA_HOURLY_STATS','V_STAMINA_DAILY_STATS'
) ORDER BY object_type, object_name;
```

最後に正しく構築できた場合は**7テーブル、9VIEW**が存在する。

## 5. Windowsの `.env` を設定

PowerShellで `str2` フォルダを開いて:

```powershell
Copy-Item .env.example .env
notepad .env
```

すでに `.env` が存在する場合は`Copy-Item`をやり直さず `notepad .env` だけで編集する（設定を上書きしないため）。

```dotenv
ORACLE_USER=STR2
ORACLE_PASSWORD=ここに自分のSTR2パスワード
ORACLE_CONNECT_STRING=192.168.56.101:1521/FREEPDB1
PORT=3000
HOST=127.0.0.1

# HoYoLABから自動取得する場合（空欄でもOracleの手動管理は動く）
HOYO_LTOKEN_V2=
HOYO_LTUID_V2=
HSR_UID=
GENSHIN_UID=
ZZZ_UID=
```

HoYoLAB側には非公式ライブラリ `node-hoyolab` を使用する。Cookieの期限切れ・API仕様変更・学校ネットワークなどで取得できない場合がある。Cookieとパスワードは**GitHub、チャット、スクリーンショットに載せない**。`.env` はGit管理の対象外。

## 6. Webアプリを起動

WindowsのPowerShellで:

```powershell
cd "$HOME\Documents\str2"
npm run check
npm start
```

保存先が異なれば `cd` のパスを変更。`npm start` によりサーバーを起動したまま、Windowsのブラウザで次を開く:

- `http://127.0.0.1:3000` (STR2画面)
- `http://127.0.0.1:3000/api/health` (Oracle接続確認)

別のPowerShellで変更する場合、起動しているサーバーは `Ctrl + C` で停止、再度 `npm start` で再起動する。`http://127.0.0.1:3000` は**Windows側のWebアプリ**であり、`192.168.56.101` は**Oracle Linux側のDB**。

## 7. 動作確認（課題発表）

1. 3ゲームのカードがOracleのVIEWから表示されるか確認。
2. 新しいタスクを追加・編集・削除し、OracleのCRUDを確認。
3. スタミナ履歴欄でゲーム・日時（JST）・消費量を手動登録。
4. 24時間の時間帯グラフ・日別推移・履歴に反映されることを確認。
5. 登録した使用履歴を個別削除して、統計からも消えることを確認。
6. HoYoLAB設定がある場合、最新のスタミナ残量を取得。異なる残量の観測から**推定**使用履歴が追加されることを確認。
7. `sql/04_verify.sql` で実表・VIEWを確認。

HoYoLABの自動観測は、Webページを開いている間に定期取得した時だけ保存される。**閉じている間の正確な使用時刻は追跡できない**。ログインボーナス情報と手動のOracle記録は別機能。

## 8. 2回目以降の起動

1. Oracle Linux仮想マシンを起動。
2. `lsnrctl services` で `FREEPDB1` が `READY` を確認（リスナーの一時設定が消えた場合は管理者が再登録）。
3. Windows PowerShellで `str2` フォルダに入り、`npm start`。
4. Windowsブラウザで `http://127.0.0.1:3000` を開く。

**2回目以降はSQLの01・02・06を毎回実行しない**。更新したコードを取り込むときだけ `git pull` と必要に応じて `npm install`。

## よくあるエラー

| 症状 | 確認先 |
|---|---|
| ORA-12541 / NJS-503 | Linuxのリスナー、IP/1521、Windows `Test-NetConnection` |
| ORA-12514 | `lsnrctl services` に `FREEPDB1` が `READY` か |
| ORA-01017 | STR2のパスワードが正しいか |
| ORA-00942 | SQLをSTR2/FREEPDB1で実行したか、対象テーブル/VIEWが作成済みか |
| ORA-01031 | `CREATE SEQUENCE` を含む必要権限、表領域QUOTA |
| ORA-02329 | 古い06スクリプトを使用。最新版を `git pull` して `OBSERVED_AT_KEY` を確認 |
| ORA-00955 | 既にテーブル作成済み。SQLを最初から再実行しない |
| HoYoLAB未取得 | Cookie・ゲームUID・ネットワーク制限・API仕様変更 |
| 使用履歴が空 | 手動登録前、またはHoYoLABの減少観測前なら正常 |

**検証状況**: GitHubコード・JavaScript構文と模擬データによるチェックまで。学校のOracle VMと実際のHoYoLAB認証をこちらから直接操作しての確認は未実施。
