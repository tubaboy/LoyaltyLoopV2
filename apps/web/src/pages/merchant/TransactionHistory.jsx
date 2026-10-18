import { useEffect, useState } from "react";
import { ArrowDownLeft, ArrowLeft, ArrowRight, ArrowUpRight, Search } from "lucide-react";
import { api } from "../../lib/api.js";
import { ErrorMessage, LoadingState } from "../../components/Brand.jsx";
import { EmptyState } from "./MerchantDashboard.jsx";

const PAGE_SIZE = 20;

function dateInputValue(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function dateRangeFor(filter, customRange) {
  if (filter === "all") return {};
  if (filter === "custom") {
    if (!customRange.start || !customRange.end) return { error: "請選擇完整的自訂日期區間" };
    if (customRange.start > customRange.end) return { error: "自訂日期的開始日不能晚於結束日" };
    return {
      dateFrom: new Date(`${customRange.start}T00:00:00`).toISOString(),
      dateTo: new Date(`${customRange.end}T23:59:59.999`).toISOString(),
    };
  }

  const now = new Date();
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  if (filter === "today") return { dateFrom: start.toISOString(), dateTo: now.toISOString() };
  if (filter === "month") {
    start.setDate(1);
    return { dateFrom: start.toISOString(), dateTo: now.toISOString() };
  }
  if (filter === "week") {
    const daysSinceMonday = (now.getDay() + 6) % 7;
    start.setDate(start.getDate() - daysSinceMonday);
    return { dateFrom: start.toISOString(), dateTo: now.toISOString() };
  }
  return {};
}

const transactionLabels = {
  add: "發放",
  redeem: "兌換",
  manual_redeem: "手動兌換",
  adjustment: "調整",
};

export default function TransactionHistory() {
  const [branches, setBranches] = useState([]);
  const [selectedBranch, setSelectedBranch] = useState("");
  const [dateFilter, setDateFilter] = useState("all");
  const [customRange, setCustomRange] = useState({ start: dateInputValue(), end: dateInputValue() });
  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [filterType, setFilterType] = useState("all");
  const [transactions, setTransactions] = useState([]);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState("");
  const [branchesLoading, setBranchesLoading] = useState(true);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let mounted = true;
    api.merchant.branches()
      .then((payload) => { if (mounted) setBranches(payload.branches ?? []); })
      .catch((loadError) => { if (mounted) setError(loadError.message ?? "無法載入分店資料"); })
      .finally(() => { if (mounted) setBranchesLoading(false); });
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    const range = dateRangeFor(dateFilter, customRange);
    if (range.error) {
      setError(range.error);
      setTransactions([]);
      setHasMore(false);
      return undefined;
    }

    let mounted = true;
    setLoading(true);
    setError("");
    api.merchant.transactions({
      branchId: selectedBranch || undefined,
      type: filterType === "all" ? undefined : filterType,
      phone: searchQuery || undefined,
      dateFrom: range.dateFrom,
      dateTo: range.dateTo,
      limit: PAGE_SIZE,
      offset: page * PAGE_SIZE,
    })
      .then((payload) => {
        if (!mounted) return;
        setTransactions(payload.transactions ?? []);
        setHasMore(Boolean(payload.hasMore));
      })
      .catch((loadError) => { if (mounted) setError(loadError.message ?? "無法載入交易明細"); })
      .finally(() => { if (mounted) setLoading(false); });
    return () => { mounted = false; };
  }, [selectedBranch, dateFilter, customRange.start, customRange.end, searchQuery, filterType, page]);

  function resetPage() {
    setPage(0);
  }

  function handleSearch(event) {
    event.preventDefault();
    setSearchQuery(searchInput.trim());
    resetPage();
  }

  function clearSearch() {
    setSearchInput("");
    setSearchQuery("");
    resetPage();
  }

  function updateDateFilter(value) {
    setDateFilter(value);
    resetPage();
  }

  if (branchesLoading) return <LoadingState label="載入交易明細…" />;

  return (
    <div className="page-stack">
      <div className="page-heading">
        <span className="eyebrow">TRANSACTION HISTORY</span>
        <h1>交易明細</h1>
        <p>依分店、日期、交易類型或會員電話查詢集點與兌點紀錄。</p>
      </div>
      <ErrorMessage message={error} />

      <section className="content-card transaction-filter-card">
        <form className="transaction-filters" onSubmit={handleSearch}>
          <label className="field-label" htmlFor="transaction-date">日期區間
            <select id="transaction-date" value={dateFilter} onChange={(event) => updateDateFilter(event.target.value)} disabled={loading}>
              <option value="all">全部日期</option>
              <option value="today">本日</option>
              <option value="week">本週</option>
              <option value="month">本月</option>
              <option value="custom">自訂區間</option>
            </select>
          </label>
          <label className="field-label" htmlFor="transaction-branch">分店
            <select id="transaction-branch" value={selectedBranch} onChange={(event) => { setSelectedBranch(event.target.value); resetPage(); }} disabled={loading}>
              <option value="">所有分店</option>
              {branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
            </select>
          </label>
          <label className="field-label" htmlFor="transaction-type">交易類型
            <select id="transaction-type" value={filterType} onChange={(event) => { setFilterType(event.target.value); resetPage(); }} disabled={loading}>
              <option value="all">全部類型</option>
              <option value="add">發放</option>
              <option value="redeem">兌換</option>
              <option value="manual_redeem">手動兌換</option>
              <option value="adjustment">調整</option>
            </select>
          </label>
          <label className="field-label transaction-search-field" htmlFor="transaction-search">會員電話
            <div className="transaction-search-input"><Search size={16} aria-hidden="true" /><input id="transaction-search" type="search" inputMode="tel" placeholder="輸入電話片段" value={searchInput} onChange={(event) => setSearchInput(event.target.value)} disabled={loading} /></div>
          </label>
          {dateFilter === "custom" && <div className="transaction-date-range"><label className="field-label" htmlFor="transaction-date-from">開始日<input id="transaction-date-from" type="date" value={customRange.start} onChange={(event) => { setCustomRange((current) => ({ ...current, start: event.target.value })); resetPage(); }} disabled={loading} /></label><span aria-hidden="true">至</span><label className="field-label" htmlFor="transaction-date-to">結束日<input id="transaction-date-to" type="date" value={customRange.end} onChange={(event) => { setCustomRange((current) => ({ ...current, end: event.target.value })); resetPage(); }} disabled={loading} /></label></div>}
          <div className="transaction-filter-actions"><button className="button button--primary" type="submit" disabled={loading}><Search size={17} aria-hidden="true" />搜尋</button>{searchQuery && <button className="button button--secondary" type="button" onClick={clearSearch} disabled={loading}>清除電話</button>}</div>
        </form>
      </section>

      <section className="content-card transaction-table-card">
        <div className="content-card__header"><div><span className="eyebrow">ACTIVITY LOG</span><h2>交易紀錄</h2></div><span className="status-pill status-pill--muted">第 {page + 1} 頁 · {transactions.length} 筆</span></div>
        {loading && transactions.length === 0 ? <LoadingState label="同步交易資料中…" /> : transactions.length === 0 ? <EmptyState title="沒有符合條件的交易紀錄" description="請調整日期、分店、交易類型或會員電話搜尋條件。" /> : <div className="table-wrap"><table className="data-table transaction-table"><thead><tr><th>交易時間</th><th>分店</th><th>會員</th><th>類型</th><th>點數變動</th><th>交易後餘額</th></tr></thead><tbody>{transactions.map((transaction) => <tr key={transaction.id}><td>{new Date(transaction.created_at).toLocaleString("zh-TW")}</td><td>{transaction.branch_name || "未指定分店"}</td><td><strong>{transaction.phone_display}</strong><small>{transaction.actor_type}</small></td><td><span className={`transaction-type ${transaction.delta > 0 ? "transaction-type--add" : "transaction-type--redeem"}`}>{transaction.delta > 0 ? <ArrowUpRight size={15} aria-hidden="true" /> : <ArrowDownLeft size={15} aria-hidden="true" />}{transactionLabels[transaction.type] ?? transaction.type}</span></td><td className={transaction.delta > 0 ? "text-positive" : "text-negative"}>{transaction.delta > 0 ? "+" : ""}{transaction.delta}</td><td>{transaction.balance_after}</td></tr>)}</tbody></table></div>}
        <div className="transaction-pagination"><button className="button button--secondary" type="button" onClick={() => setPage((current) => Math.max(0, current - 1))} disabled={loading || page === 0}><ArrowLeft size={16} aria-hidden="true" />上一頁</button><span>第 {page + 1} 頁</span><button className="button button--secondary" type="button" onClick={() => setPage((current) => current + 1)} disabled={loading || !hasMore}>下一頁<ArrowRight size={16} aria-hidden="true" /></button></div>
      </section>
    </div>
  );
}
