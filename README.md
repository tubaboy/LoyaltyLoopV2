# LoyaltyLoopV2

LoyaltyLoopV2 是 LoyaltyLoop 的獨立重製版本。舊專案僅作為參考，本專案不會修改舊專案。

## 本機 Docker 環境

使用前需要：

- 已啟用 Linux Engine 的 Docker Desktop
- Docker Compose v2 或更新版本

首次建立本機環境時，複製環境變數範本並設定僅供本機使用的密碼：

```powershell
Copy-Item .env.example .env
```

請將範本中的密碼換成自己的本機密碼；`.env` 已列入 Git 忽略，不會推送到 GitHub。

啟動本機環境：

```powershell
docker compose up --build -d
```

本機服務位置：

- Web：<http://localhost:5173>
- API 健康檢查：<http://localhost:3000/healthz>
- API 就緒檢查：<http://localhost:3000/readyz>
- PostgreSQL：`localhost:55432`

PostgreSQL、API 與 Web 的對外埠僅綁定 `127.0.0.1`，只供本機使用。上傳圖片與音效由 API 寫入 Docker named volume `media_data`，不需要 MinIO 或其他物件儲存服務。

資料庫初始化腳本只會建立 V2 schema，不會連線或匯入舊 LoyaltyLoop 系統。

既有本機資料庫的結構更新會放在 `infra/postgres/migrations/`，不會重建或清空資料。套用新 migration 的 PowerShell 範例：

```powershell
Get-Content -Raw -Encoding utf8 infra/postgres/migrations/002_branch_custom_sounds.sql |
  docker compose exec -T db sh -c 'psql -X -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
```

## 經授權的本機舊資料匯入

資料遷移指令必須明確指定 `SOURCE_DATABASE_URL`，預設只會執行試跑。程式不會自行猜測來源資料庫。

```powershell
docker compose exec -T `
  -e "SOURCE_DATABASE_URL=<local-only-source-connection-string>" `
  api npm run migrate:legacy
```

指令會使用 Docker Compose 設定的本機 `DATABASE_URL` 作為目標。檢查報告後，在指令最後加入 `-- --apply`，才會將轉換後的資料寫入該目標資料庫。匯入的商戶帳號在設定 V2 密碼前會保持停用；舊 LINE 綁定與舊圖片 URL 不會匯入，圖片必須透過 V2 重新上傳。

資料遷移會保留舊系統的 UUID、會員、點數餘額、集點選項與點數交易，並且可以安全地對同一個本機目標重複執行。請勿將來源連線字串、憑證或備份檔案放入儲存庫。

若要在本機啟用一個匯入的帳號，程式會使用 Docker Compose 設定的本機 `DATABASE_URL`，並拒絕正式環境模式與非本機資料庫主機：

```powershell
docker compose exec -T `
  -e "ACCOUNT_EMAIL=<merchant-email>" `
  -e "NEW_PASSWORD=<new-password-at-least-12-characters>" `
  api npm run activate:account
```

啟用後，商戶可以在設定頁修改密碼，也可以在設定頁重新上傳圖片。圖片資產會受到商戶工作階段或 Terminal 工作階段保護。

設定頁也支援 V2 分店操作：分店聯絡資訊與顯示設定、兌換上限、Terminal 效果與逾時設定。Terminal key 只有在使用者要求時才會產生，新金鑰固定為容易輸入的 8 位數字；資料庫只儲存 SHA-256 雜湊值，明文只會顯示一次，並且可以撤銷或重新產生。為了相容本機既有資料，先前產生的 12 碼 V2 英數金鑰仍可登入；重新產生後會改用 8 位數字金鑰。撤銷或重新產生 key 時，也會撤銷該分店目前有效的 Terminal 工作階段。

設定頁的圖片資產區會顯示每個分店目前已儲存的 Logo 與待機畫面預覽；沒有圖片時會明確顯示尚未上傳。預覽透過登入權限讀取，不會公開圖片資產。

分店設定也可分別上傳集點與兌換 MP3 音效（每個檔案上限 1 MB），可在後台試聽或恢復預設。沒有自訂音效時，終端沿用內建的 `coin.mp3` 與 `celebration.mp3`；替換或恢復預設後，已開啟的終端需重新載入設定。新音效會存放為受商家／分店權限保護的媒體資產，替換後不再被引用的舊檔會清理。

目前本機 API 包含：

- `GET /api/v2/merchant/dashboard`：支援日期、統計粒度與分店篩選
- `GET/POST /api/v2/merchant/branches`：查詢與建立分店
- `PATCH/DELETE /api/v2/merchant/branches/:branchId`：修改與刪除分店
- `PATCH /api/v2/merchant/branches/:branchId/settings`：修改分店設定
- `POST /api/v2/merchant/branches/:branchId/terminal-key`：建立 Terminal key
- `POST /api/v2/merchant/branches/:branchId/terminal-key/revoke`：撤銷 Terminal key
- `POST /api/v2/merchant/media`：上傳最大 5 MB 的 JPG、PNG 與 WebP 圖片
- `GET/POST /api/v2/merchant/loyalty-options`：查詢與建立集點選項
- `PATCH/DELETE /api/v2/merchant/loyalty-options/:optionId`：修改與刪除集點選項
- `GET /api/v2/merchant/customers`：支援分店、電話／關鍵字與 offset 篩選
- `GET /api/v2/merchant/customers/:customerId`：取得含分頁點數活動的會員詳細資料
- `GET /api/v2/merchant/transactions`：支援分店、日期、類型、電話與 offset 篩選
- `GET/POST /api/v2/admin/merchants`：查詢與建立商戶
- `PATCH /api/v2/admin/merchants/:merchantId`：修改商戶資料
- `POST /api/v2/admin/merchants/:merchantId/reset-password`：重設商戶密碼

商戶的「集點選項」頁支援分店選擇、每日兌換上限、增加／兌換選項的建立、編輯、排序、啟用／停用與刪除。Terminal 只會讀取啟用中的選項；停用的選項仍會保留在商戶後台，之後可以重新啟用。

商戶的「會員」頁支援電話搜尋、分店活動篩選、分頁、目前餘額摘要與單一會員的點數交易歷史。

商戶 Dashboard 支援今天／本週／本月／自訂日期範圍、分店篩選、資料庫端點數統計、趨勢資料、近期活動、會員排名、分店摘要與 CSV 匯出。

商戶的「分店」頁支援建立、編輯、複製與刪除沒有交易紀錄的分店。有交易歷史的分店不可刪除，必須改為停用。

Terminal 支援會員查詢、累加點數、受每日上限限制的一般兌換、手動扣除點數與快速集點選項。修改電話輸入內容時，會先清除前一次查詢的會員資料，避免誤操作其他會員。

## 本機手動驗收清單

匯入的舊帳號是刻意保持停用狀態，舊密碼雜湊值也不會複製。開始測試前，請使用上方的 `activate:account` 指令啟用要測試的本機帳號，並使用至少 12 個字元的新密碼。若要測試 Admin 頁面，請依需求啟用角色為 `super_admin` 或 `admin` 的本機帳號；不要使用正式環境憑證。

確認容器處於健康狀態後，開啟 <http://localhost:5173>，並驗證以下流程：

1. 商戶登入、登出、修改密碼與工作階段逾時行為。
2. Dashboard 的今天／本週／本月／自訂日期篩選、分店篩選、KPI 數值、圖表的表格替代內容、近期交易、會員排名、分店摘要與 CSV 匯出。
3. 分店管理：建立、編輯、複製、停用、重新啟用，並確認有交易歷史的分店不可刪除。
4. 分店設定：聯絡／顯示設定、兌換上限、Terminal 效果／逾時、現有 Logo／待機畫面預覽、圖片重新上傳、Terminal key 建立與撤銷。
5. 集點選項：建立、編輯、排序、啟用／停用與刪除選項；確認停用選項不會出現在 Terminal。
6. 會員：電話搜尋、分店篩選、分頁、餘額顯示、會員詳細資料與點數活動歷史。
7. 交易：分店／日期／類型／電話篩選、分頁與交易詳細數值。
8. Terminal：使用 8 位數字金鑰登入分店 Terminal、會員查詢、累加點數、一般兌換、每日上限處理與手動扣除點數。
9. Admin（已啟用管理員帳號時）：商戶列表搜尋／分頁、建立商戶、編輯商戶狀態／聯絡資料與重設密碼。確認建立後不會顯示復原密碼。

為了方便重複驗證，請記住匯入資料的預期基準：3 個帳號、3 個商戶、2 個分店、1,429 位會員、11 個集點選項與 7,711 筆點數交易。只有在準備好要變更本機資料集時，才建立測試分店或商戶。

停止 V2 環境，不會影響其他 Docker 專案：

```powershell
docker compose down
```

`docker compose down` 會刻意保留 PostgreSQL 與媒體檔案具名磁碟區。只有在明確確認本機 V2 測試資料可以丟棄時，才移除這些磁碟區。

Railway 部署時，請將 Volume 掛載至 API 服務的 `/var/lib/loyaltyloop/media`；API 會將上傳檔案直接寫入此持久化路徑。Volume 與服務所在區域綁定，API 服務需使用單一副本；若未掛載持久化 Volume，容器重建後上傳檔案可能遺失。資料庫與媒體檔案仍需各自設定備份。

## PWA（Android 門市平板）

V2 的 Web App Manifest 會讓安裝到平板的 LoyaltyLoop 以獨立視窗啟動，並直接開啟分店終端登入頁。Service Worker 只快取前端建置檔、離線提示頁與必要圖示；會員、登入、點數和交易 API 一律需要連線，不會快取或排隊。

Service Worker 僅在 production build 中產生。可在 `apps/web` 執行 `npm run build`，再執行 `npm run preview`，於本機 `http://localhost:4173` 驗證 production build。平板實機安裝需使用 HTTPS 網址；連到電腦的區網 HTTP 位址不適合作為 Service Worker 的安裝驗收環境。

Railway 使用的 Web production image 由 `apps/web/Dockerfile.railway` 建置，提供靜態 PWA、SPA 路由與同源 `/api/` 代理。可用本機 Docker 預覽此 image：`docker compose --profile tablet-preview up -d --build web-production-preview`，網址為 `http://localhost:4174/terminal-login`；預覽服務停止後，本機開發服務仍使用 `http://localhost:5173`。

在 Android Chrome 開啟 HTTPS 測試網址後，從瀏覽器選單選擇「安裝應用程式」或「加到主畫面」（名稱會依瀏覽器版本略有不同）。安裝後從桌面圖示啟動，應直接進入終端登入頁，且不顯示 Chrome 網址列。Android 系統狀態列仍可能顯示，若需鎖定平板操作，需另外設定裝置的螢幕固定或 kiosk 模式。

實機驗收：首次安裝前保持連線；確認終端登入、會員查詢、集點、兌換與音效正常；關閉網路後確認離線提示出現，登入與點數操作不可用；重新連線後確認可正常操作。發布新版本後，確認更新提示出現，並在完成目前操作後手動更新，避免交易進行中自動重載。

