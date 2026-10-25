# 緊急切換至 Ubuntu 快速指南

本文件說明故障切換流程。現有 Windows/macOS 啟動器含主機專用連線目標，暫時只保留在本機，待改為讀取受保護的本機設定後再評估納入 app repo。

## Windows 現場電腦

1. 確認 Mint 主機已關機，或已實際從網路隔離；不要只因網頁打不開就切換。
2. 雙擊桌面捷徑「LoyaltyLoopV2 - 緊急切換至 Ubuntu」。
3. 輸入 `MINT_ISOLATED` 確認，等待腳本檢查 WAL、提升 Ubuntu、啟動服務。
4. 腳本顯示切換完成後，平板開啟事先確認可用的 Ubuntu V2 HTTPS 位址。不要只以首頁載入判定資料庫切換成功。

若 SSH 連線失敗或 Mint 複寫埠仍可連線，腳本會拒絕提升資料庫。若提升後 API 或 web 啟動失敗，Ubuntu 可能已是可寫主庫；不要把 Mint 恢復為可寫主機。

日常可用 SSH 執行遠端 `bash /opt/loyaltyloop-v2-ubuntu/ops/failover-ubuntu.sh --preflight` 查看待命狀態；此模式不會提升 DB 或啟動服務。

## macOS（Terminal）

需先將專案目錄放在 Mac 上，並確認該 Mac 已設定可登入 Ubuntu 的 SSH key 與已驗證的 host key。不要略過 SSH host key 驗證。

```bash
cd /path/to/LoyaltyLoopV2
bash ops/failover/failover-ubuntu-mac.sh
```

輸入 `MINT_ISOLATED` 後，腳本會連到 Ubuntu 執行相同的遠端切換流程。

## 重要規則

- Ubuntu 提升後是唯一可寫主庫。故障期間只使用 Ubuntu，不要同時恢復 Mint 寫入。
- 資料庫是非同步複寫；突然故障可能缺少尚未送達 Ubuntu 的最後幾筆交易。
- Ubuntu 會顯示最後一次成功媒體同步時間；若剛上傳的素材尚未送達，資料庫仍可集點，但圖片／音效可能暫時缺少。
- Mint 恢復後不可直接切回。先保留 Ubuntu 故障期間的資料，再安排以 Ubuntu 為來源重建 Mint standby。
