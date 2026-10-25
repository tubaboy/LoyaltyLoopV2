# 備份相關檔案

## 現行流程

每日 Ubuntu PostgreSQL 備份由私有的 `tubaboy/LoyaltyLoopV2-Ubuntu-Database-backups` repo 管理。此 V2 app repo 不保存資料庫 dump、GitHub SSH 私鑰、age 私鑰或主機環境設定。

現行 workflow 是資料庫限定的 GitHub Actions artifact 備份，保留 30 天；媒體檔同步是另一個服務，不屬於此備份 artifact。設定與操作說明見 `docs/backup-and-restore.md`。

## 本目錄用途

- `create-age-key.cmd` / `create-age-key.ps1`：供管理者離線建立 age 解密身分與公鑰；私鑰不可加入 repo 或主機。
- `archive/`：舊 Google Drive/rclone 實驗與備份 repo 的本機鏡像，僅為保留歷史，不是現行流程。此目錄由 `.gitignore` 排除，不會納入 V2 app repo。

不要執行 archive 內的 Google Drive 備份、還原或 OAuth 工具；它們與目前已啟用的 GitHub Actions workflow 不相容。
