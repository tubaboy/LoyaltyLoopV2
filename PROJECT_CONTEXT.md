# LoyaltyLoopV2 共用專案脈絡

最後整理：2026-10-25（Asia/Taipei）

這是供新對話快速接續的摘要，不取代使用者最新指示。不得在本文件記錄密碼、PIN、token、私鑰、連線字串、實際 `.env` 值或資料庫／備份內容。

## 專案目標與邊界

- LoyaltyLoopV2 是獨立 V2；舊版 LoyaltyLoop 是正式系統，不能修改、刪除或重新命名。
- 不連線或操作正式 Supabase、Zeabur 或正式資料。只在使用者明確授權的本機／Mint／Ubuntu 範圍操作。
- 不自行 commit、push 或部署。使用者要先檢視待提交內容，再明確核准 push。
- 使用繁體中文；說明直接清楚，避免要求使用者執行複雜命令。

## 架構與產品

- Web：React + Vite，含商家管理後台、分店終端登入與集點／兌換介面；已加入 PWA 資源。
- API：Node.js、Express、TypeScript；資料庫：PostgreSQL。
- 圖片、Logo、待機畫面與音效使用本機持久化媒體儲存；不使用 Supabase 或 MinIO。
- LINE Bot 與 n8n 已取消。
- 終端流程沿用舊版主要操作順序；管理後台主要用電腦，平板主要用於終端操作。
- 設定支援自訂音效、待機畫面與商店 Logo；終端集點特效已針對舊平板效能調整並延長顯示時間。

## 主機現況

- Mint 是店內主要操作點，也是目前 PostgreSQL primary；Ubuntu 是 PostgreSQL physical standby。
- PostgreSQL 複寫為 Mint → Ubuntu 單向非同步複寫。Ubuntu 平時不提供 API/web 寫入；API/web 服務停用，standby DB 與媒體接收服務運行。
- Mint 的 V2 與 OmniScreen 使用獨立 Compose 專案、容器與資料卷。操作 V2 不得停止、覆蓋或共用 OmniScreen 資源。
- 媒體檔另由 Mint 同步至 Ubuntu；此流程與 PostgreSQL 複寫分離，須另外確認同步狀態。
- 故障切換是人工操作，沒有自動 failover。切換前必須確認 Mint 已 fencing／停止寫入，避免 split brain；Ubuntu 提升後不得直接切回舊 Mint primary。
- 店內／Tailscale 網址與主機 IP 會變動，應從使用者已知的主機設定或當次上下文取得；不要複製到共用文件。

## 異地資料庫備份

- 每日備份 workflow 位於私有 repo：[`tubaboy/LoyaltyLoopV2-Ubuntu-Database-backups`](https://github.com/tubaboy/LoyaltyLoopV2-Ubuntu-Database-backups)。
- GitHub Actions 每日台灣時間 02:23 執行，也支援手動觸發；備份 artifact 保留 30 天。
- Ubuntu 在傳送前以 age 公鑰加密完整 PostgreSQL dump；artifact 只包含加密 dump 與 SHA-256 checksum，不包含媒體或主機設定。
- 專用 SSH key 受 forced command 限制，只能執行資料庫匯出。私鑰不進 Git；age 解密私鑰離線保管。
- 2026-10-25 已成功手動執行首次 workflow 並產生加密 artifact。完整解密與隔離資料庫還原演練尚未完成。
- Google Drive/rclone 方案已取消；相關舊腳本只保留在本機忽略的 archive，不可當作現行備份流程。

## 重要操作文件

- `docs/mint-ubuntu-replication.md`：複寫拓撲與人工切換。
- `docs/failover-quick-guide.md`：現場快速切換注意事項。
- `docs/backup-and-restore.md`：目前 GitHub Actions 加密資料庫備份流程與尚待演練的還原邊界。
- `ops/backup/README.md`：V2 app repo 中備份相關檔案的用途與排除項目。

## Git 與待提交狀態

- V2 app repo 的上次確認分支為 `main`，GitHub `origin/main` 與本機基準 commit 相同；本機另有未提交程式修改與未追蹤檔案。
- 2026-10-25 的唯讀比對顯示：Mint 與 Ubuntu 的部署目錄不是 Git checkout；若干核心 API 檔案與本機工作樹的 SHA-256 相同，但主機專屬 Compose/nginx 設定不同。
- 不可因此宣稱三地完整檔案樹相同。任何 push 前需檢視 `git status`、差異與文件，並由使用者確認。
- 主機專用 `.env.mint.example` 值尚未審查，已由 `.gitignore` 排除；Windows/macOS 故障切換啟動器含主機專用連線目標，也暫時保持本機忽略狀態。
- 今日整理只限本機檔案；不得自行推送 V2 app repo 或備份 repo。

## 安全規則

- 不讀取或輸出真實 `.env`、憑證、私鑰、資料庫內容或會員資料；範例檔也要先確認不含真實值，才能提交。
- 不刪除 Docker volume、資料庫備份或使用者建立的檔案。先保留可回復路徑。
- 不在 repo 文件或範例中寫入主機 IP、Tailscale 位址、token、密碼或實際 SSH key。
- 更新主機服務前先確認主機、容器與掛載；資料匯入、覆蓋、刪除、重啟、commit、push 與外部部署皆需遵守當次授權。

## 接續建議

1. 完成工作樹檔案分類與文件審查，讓使用者先確認。
2. 取得使用者核准後，才挑選並提交適合進 V2 app repo 的檔案。
3. 到店後再用平板驗證 Mint；之後安排 artifact 的隔離資料庫還原演練。
4. 使用者同意前，不 push、不部署、不觸碰正式系統。
