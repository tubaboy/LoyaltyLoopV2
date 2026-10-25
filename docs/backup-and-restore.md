# Ubuntu V2 加密資料庫備份與還原

## 目前備份方式

每日資料庫備份由私有 repository [`tubaboy/LoyaltyLoopV2-Ubuntu-Database-backups`](https://github.com/tubaboy/LoyaltyLoopV2-Ubuntu-Database-backups) 的 GitHub Actions workflow 執行。

- 排程：每日台灣時間 02:23；也可從 Actions 手動執行。
- 範圍：完整 PostgreSQL custom-format dump，包含 schema 與資料。
- 加密：Ubuntu 在傳送前以 `age` 公鑰加密；GitHub Actions artifact 只收到密文與 SHA-256 checksum。
- 保存：artifact 保留 30 天。備份檔不提交到 Git。
- 不包含：媒體檔、主機環境設定、TLS 憑證或應用程式原始碼。媒體副本目前由 Mint → Ubuntu 的獨立同步機制處理。
- 私鑰：對應的 `age` 解密私鑰由管理者離線保管，不放在 repo、Mint 或 Ubuntu。

2026-10-25 已手動執行一次 workflow，GitHub Actions 顯示成功並產生加密 artifact。每日排程已設定；需要持續確認後續排程執行成功。

## 確認最近備份

1. 開啟上述備份 repository 的 **Actions**。
2. 確認最新的 **Ubuntu V2 encrypted database backup** run 為 **Success**。
3. 確認該 run 有一個 `ubuntu-v2-db-...` artifact。若執行失敗或沒有 artifact，該次不算成功備份。

具有 repo 讀取權限的人可以下載加密 artifact；只有持有相符 `age` 私鑰的人才能解密。

## 還原前注意事項

目前的 GitHub artifact 還原流程尚未完成全程演練。本節提供安全邊界與大致步驟，不代表已驗證的正式災難復原程序。首次演練應在隔離的測試 PostgreSQL 上進行，不可直接對正在營運的 Mint 或 Ubuntu 資料庫操作。

artifact ZIP 內含加密 dump 與 checksum。還原時應：

1. 從成功的 workflow run 下載 artifact，並在私有工作目錄解壓縮。
2. 先用 checksum 檔確認加密 dump 完整。
3. 使用離線保管的 `age` 私鑰解密；私鑰不放在 repo 或命令列參數中。解密後的 dump 視同完整資料庫備份，需在受限權限、加密儲存空間中暫存。
4. 使用 PostgreSQL 16 的 `pg_restore --list` 檢查 dump 可讀。
5. 先還原至獨立、空白的測試資料庫，驗證帳號、會員、點數與交易資料，再規劃正式切換。
6. 若要覆蓋既有資料庫，先做另一份可還原備份、停止 API/web、確認目標主機與資料庫，並由管理者明確核准操作。
7. 媒體不在此 artifact 內；若需要還原媒體，須另從可用的媒體副本處理。

GitHub artifact 最多保留 30 天；需要超過此期限的長期副本時，必須另行決定並驗證新的儲存方案。Google Drive 舊方案已停用，不是目前備份目的地。

## 目前限制

- 此 workflow 只備份資料庫，不備份媒體 volume 或主機設定。
- Ubuntu 必須可連線，GitHub Actions 才能取得當日 dump；若主機或 SSH 無法連線，當次工作會失敗。
- 尚未完成從 artifact 到隔離 PostgreSQL 的解密與還原演練。正式依賴此備份前，應先完成演練並記錄可重現步驟。
