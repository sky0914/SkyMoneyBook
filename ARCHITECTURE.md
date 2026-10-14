# SkyMoneyBook 工程架構

依 2026-10-14 專案原始碼整理；描述目前實作，不代表正式雲端已部署相同版本。未確認前端託管平台及 Apps Script 實際存取權限。

## 系統架構

```mermaid
flowchart TB
    User[使用者] --> UI
    CDN[外部 CDN<br/>Vue 3 / Tailwind CSS / Font Awesome] -. 載入依賴 .-> UI
    subgraph Browser[瀏覽器：index.html 單頁應用]
        UI[頁面介面<br/>開銷 / 年度總表 / 基金 / 資產 / 配息]
        Stocks[股票頁籤<br/>目前只有空白內容區]
        State[Vue ref / computed<br/>編輯資料、篩選、金額計算]
        Sync[同步協調<br/>readCloud / saveCloud / retrySave]
        Memory[記憶體快照<br/>remoteSnapshot / cleanData / pendingSave]
        Local[localStorage<br/>只保存常用項目]
        UI --> State
        UI --> Stocks
        State --> Sync
        Sync <--> Memory
        UI <--> Local
    end
    subgraph Backend[Google Apps Script：GAS]
        API[doGet / doPost<br/>JSON API，protocolVersion 6]
        Guard[輸入與表頭驗證<br/>ScriptLock + SHA-256 revision]
        Adapter[read_ / replaceRows_<br/>資料物件與工作表欄列轉換]
        API --> Guard --> Adapter
    end
    Sync -->|GET：全量載入或指定 dataset| API
    Sync -->|POST：action + dataset + expectedRevision| API
    API -->|GET 回傳資料及 revisions| Sync
    subgraph Sheets[Google Sheets：單一記帳試算表]
        T[明細]
        S[年度摘要]
        F[基金投資明細]
        A[資產負債]
        C[現金流配息記錄]
        Legacy[舊版基金投資<br/>相容讀取]
    end
    Adapter <--> T
    Adapter <--> S
    Adapter <--> F
    Adapter <--> A
    Adapter <--> C
    Legacy -. 新表不存在時讀取 .-> Adapter
```

畫面、計算和同步函式都在同一份 `index.html`；圖中的前端區塊是邏輯分工，尚未拆成獨立元件或模組。後端是一份 Apps Script 原始碼，Google Sheets 是主要持久化儲存。

## 儲存時序

```mermaid
sequenceDiagram
    actor U as 使用者
    participant V as Vue 頁面
    participant G as Apps Script
    participant S as Google Sheets
    V->>G: 初始 GET
    G->>G: 取得 ScriptLock
    G->>S: 讀取各 dataset
    S-->>G: 工作表資料
    G-->>V: JSON + revisions + protocolVersion
    U->>V: 修改資料並按儲存
    V->>V: 建立 expected 快照與 pendingSave
    V->>G: POST action + dataset + expectedRevision（no-cors）
    G->>G: 驗證輸入並取得 ScriptLock
    G->>S: 讀取指定 dataset
    G->>G: 比對目前 revision
    alt revision 相同
        G->>S: 批次更新工作表並 flush
    else revision 不同
        G->>G: 拒絕寫入
    end
    Note over V,G: 前端不讀取 no-cors POST 回應內容
    V->>G: GET dataset（確認結果）
    G->>S: 讀取指定 dataset
    G-->>V: 資料 + 新 revision
    alt 雲端內容與 expected 相同
        V->>V: 更新快照並清除 pendingSave
        V-->>U: 顯示儲存成功
    else 不一致、衝突或網路失敗
        V->>V: 保留修改與 pendingSave
        V-->>U: 顯示失敗或衝突，可重試
    end
```

一般修改是 POST 後 GET 確認，最多嘗試四次確認讀取。重試或沒有新修改時會先 GET：若雲端已有相同內容，直接確認成功；若雲端已被改動，保留修改並拒絕覆蓋。

## 功能與資料映射

| 畫面 | 前端資料 | 儲存 action | 工作表與粒度 |
|---|---|---|---|
| 日常開銷明細 | `transactions` | `saveTransactions` | 明細，5 欄，每筆收支一列 |
| 每月摘要／年開銷總表 | `allSummaries` → API `summaries` | `saveSummary` | 年度摘要，10 欄，年度與月份 |
| 基金投資 | `fundsRecords` | `saveFunds` | 基金投資明細，11 欄，年度／基金／月份；每年度 39 列 |
| 總資產 | `assetsRecords` | `saveAssets` | 資產負債，42 欄，以年月索引 |
| 配息 | `cashflowRecords` | `saveCashflow` | 現金流配息記錄，9 欄，每年度 13 列 |
| 股票 | 尚無資料模型 | 尚無 | 尚無 |

每次儲存會提交該類資料的完整集合，並更新對應工作表，不是只更新畫面目前顯示的一筆或一年。

```mermaid
flowchart LR
    T[收支明細] -->|按年月統計生活開銷| S[每月摘要與年度總表]
    T -->|依分類累計| Categories[本月各分類開銷]
    F[基金：安泰台幣每月利息] -->|同年度、同月份唯讀帶入| C[配息基金台幣欄]
    C -->|加上其他配息及定存利息| CT[配息總計：不換算匯率]
    A[資產、負債、投資與外幣] -->|外幣乘手動匯率並合計| AT[總財產]
```

基金和資產資料目前各自保存；圖中没有基金自動同步至資產的資料流。配息提交會帶入基金台幣利息快照，基金有未儲存修改時先阻止配息提交。

## 工程特性與限制

- 前端直接從 CDN 載入依賴，沒有套件管理或建置設定；前端託管位置未記錄於專案。
- 主要財務資料及未確認修改保留在頁面記憶體；`localStorage` 僅保存常用記帳項目，沒有財務草稿持久化。
- 後端以整類資料的內容雜湊做樂觀版本檢查；同一資料類別不同年度的更新也可能互相衝突。
- `ScriptLock` 協調同一 Apps Script 專案的請求，無法鎖住使用者直接編輯 Sheets 或其他 Apps Script 專案的寫入。
- 五類資料獨立儲存，沒有跨工作表交易；基金與配息的先後儲存約束由前端處理。
- 原始碼沒有自行實作登入與使用者授權；實際存取控制依 Apps Script 部署設定，尚未驗證。
- `tests/sync.test.cjs`、`tests/cashflow.test.cjs` 用模擬網路與試算表驗證邏輯；`tests/browser-sync.cjs` 使用 Vue 與 Chromium，但試算表仍是模擬。這份架構整理未執行測試或操作正式財務資料。

## 原始碼定位

- `index.html`：介面、狀態、計算、搜尋、同步及未儲存提醒。
- `GAS`：API、資料驗證、版本檢查、工作表讀寫與舊格式相容。
- `SYNC_SETUP.md`：部署與同步協定說明。
- `CASHFLOW_SPEC.md`：配息欄位與基金利息帶入規則。
- `tests/`：同步、配息與瀏覽器測試。
- `backups/`：本地修改前的原檔備份，不是雲端財務資料備份。
