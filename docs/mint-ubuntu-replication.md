# Mint → Ubuntu PostgreSQL 備援複寫

## 拓撲與限制

- Mint 是唯一可寫主庫；Ubuntu 是 PostgreSQL physical standby，透過 Tailscale 上的專用連接埠串流 WAL。
- V2 nginx 透過 Docker embedded DNS 動態解析 API 服務位址，避免 API 容器重建後舊 IP 造成 502。
- Ubuntu 平時不對外提供 V2 API／前端，避免操作人員誤以為它可寫。一般 `docker compose up -d` 只啟動 standby DB；API 與 web 位於 `primary` profile。
- Ubuntu 的舊可寫資料卷 `loyaltyloop_v2_ubuntu_postgres` 保留作回復資料，不再掛到目前 Compose 的 DB。
- PostgreSQL 複寫不包含媒體 volume；圖片、Logo、待機圖、音效由獨立媒體同步服務備援。
- 媒體檔現在由 Mint API 上傳後觸發同步，並每 60 秒做一次完整核對；使用 SHA-256，僅傳送缺漏或內容不同的物件。Ubuntu 接收服務只綁 Tailscale 網路介面上的專用連接埠，以獨立 bearer token 驗證，與 Ubuntu standby DB/API 解耦。實際位址與 token 僅保存在主機設定，不記入文件或 repo。
- Mint 無法連到接收服務時，集點／設定上傳不會因同步失敗而中斷；API 每分鐘重試。Ubuntu 接收端以暫存檔加原子 rename 寫入媒體 volume。Mint manifest 中已消失的舊檔會在 Ubuntu 保留 7 天，之後才清理，降低 DB 複寫延遲造成資產暫時缺檔的風險。
- 查最近媒體同步時間：Ubuntu `docker logs --since 24h loyaltyloop-v2-media-sync`；成功時會有 `MEDIA_SYNC_MANIFEST assets=... removed=...`。Mint API 端的 `MEDIA_SYNC_OK` 代表本輪比對與 manifest 都成功；`MEDIA_SYNC_FAILED` 會在下一輪重試。
- 此拓撲不會自動故障切換。故障時需確認 Mint 已停止寫入，再手動提升 Ubuntu；網路分割期間不可讓兩端同時可寫。
- 一旦 Ubuntu 被提升並接受寫入，Mint 恢復後不可直接接回舊主庫。須先決定以哪邊為準，將未複寫交易保存，再以存活主庫重新建立另一端 standby。

## 日常檢查

在 Mint 檢查送出端：

```sql
SELECT application_name, client_addr, state, sent_lsn, write_lsn,
       flush_lsn, replay_lsn, write_lag, flush_lag, replay_lag
FROM pg_stat_replication;
```

在 Ubuntu 檢查接收端：

```sql
SELECT pg_is_in_recovery();
SELECT status, flushed_lsn, latest_end_lsn, latest_end_time
FROM pg_stat_wal_receiver;
```

正常時 Ubuntu 的 `pg_is_in_recovery()` 為 `true`，且 WAL receiver 狀態為 `streaming`。

## 人工故障切換（僅故障時）

1. 確認 Mint API 已停止接受寫入；若 Mint 主機可用，先停止 V2 API/web，再確認資料庫已停止或封鎖新寫入。
2. 確認 Ubuntu standby 的 WAL 已追到 Mint 最後送出的 LSN。無法確認時，記錄可能遺失的最後交易時間並由管理者決定是否接受風險。
3. 在 Ubuntu 呼叫 `pg_promote()`，確認 `pg_is_in_recovery()` 變為 `false`。
4. 只有提升完成後，才在 `/opt/loyaltyloop-v2-ubuntu` 使用 `docker compose --env-file .env.ubuntu --profile primary -f docker-compose.ubuntu.yml up -d api web` 啟動 Ubuntu API／前端。
5. 故障期間所有操作只使用 Ubuntu；不要同時恢復 Mint 寫入。
6. Mint 恢復後不要直接切回。先備份兩端、保留 Ubuntu 故障期間新增交易，再規劃以 Ubuntu 為來源重建 Mint standby 或做經人工審核的資料回補。

本文件是操作說明；故障切換須由操作人員明確啟動工具，不會自動提升或回補資料。

## 操作工具

- Ubuntu 執行器：`/opt/loyaltyloop-v2-ubuntu/ops/failover-ubuntu.sh`。必須帶 `--mint-fenced`，並且 Mint PostgreSQL Tailscale 埠不可連線；否則會拒絕提升。`--preflight` 僅顯示 standby、最後重播時間、媒體同步時間與 Mint 連線狀態，不會變更服務。
- Windows：桌面捷徑「LoyaltyLoopV2 - 緊急切換至 Ubuntu」，再輸入 `MINT_ISOLATED`。它透過 OpenSSH 呼叫 Ubuntu 執行器。
- macOS：在專案目錄執行 `bash ops/failover/failover-ubuntu-mac.sh`，輸入相同確認字串。Mac 必須先有 Ubuntu 授權的 SSH 金鑰與 host key trust。
- Ubuntu API/web 映像已預先建置；故障時以 `--no-build` 啟動，避免等待下載或編譯。切換工具只在事件時執行；平時勿使用 `--mint-fenced`。
