import { ArrowDownLeft, ArrowLeft, ArrowRight, ArrowUpRight, Search, UserRound, X } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "../../lib/api.js";
import { ErrorMessage, LoadingState } from "../../components/Brand.jsx";
import { EmptyState } from "./MerchantDashboard.jsx";

const PAGE_SIZE = 20;

const transactionLabels = {
  add: "發放",
  redeem: "兌換",
  manual_redeem: "手動兌換",
  adjustment: "調整",
};

function formatDate(value) {
  return value ? new Date(value).toLocaleString("zh-TW") : "—";
}

function clearSelection(setSelectedCustomerId, setDetail, setDetailError) {
  setSelectedCustomerId("");
  setDetail(null);
  setDetailError("");
}

export default function CustomerManagement() {
  const [branches, setBranches] = useState([]);
  const [selectedBranch, setSelectedBranch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [customers, setCustomers] = useState([]);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [selectedCustomerId, setSelectedCustomerId] = useState("");
  const [detail, setDetail] = useState(null);
  const [detailPage, setDetailPage] = useState(0);
  const [error, setError] = useState("");
  const [detailError, setDetailError] = useState("");
  const [branchesLoading, setBranchesLoading] = useState(true);
  const [loading, setLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);

  useEffect(() => {
    let mounted = true;
    api.merchant.branches()
      .then((payload) => { if (mounted) setBranches(payload.branches ?? []); })
      .catch((loadError) => { if (mounted) setError(loadError.message ?? "無法載入分店資料"); })
      .finally(() => { if (mounted) setBranchesLoading(false); });
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    setError("");
    api.merchant.customers({
      branchId: selectedBranch || undefined,
      search: searchQuery || undefined,
      limit: PAGE_SIZE,
      offset: page * PAGE_SIZE,
    })
      .then((payload) => {
        if (!mounted) return;
        setCustomers(payload.customers ?? []);
        setHasMore(Boolean(payload.hasMore));
      })
      .catch((loadError) => { if (mounted) setError(loadError.message ?? "無法載入會員資料"); })
      .finally(() => { if (mounted) setLoading(false); });
    return () => { mounted = false; };
  }, [selectedBranch, searchQuery, page]);

  useEffect(() => {
    if (!selectedCustomerId) {
      setDetail(null);
      setDetailError("");
      return undefined;
    }

    let mounted = true;
    setDetailLoading(true);
    setDetailError("");
    api.merchant.customer(selectedCustomerId, { limit: PAGE_SIZE, offset: detailPage * PAGE_SIZE })
      .then((payload) => { if (mounted) setDetail(payload); })
      .catch((loadError) => { if (mounted) setDetailError(loadError.message ?? "無法載入會員明細"); })
      .finally(() => { if (mounted) setDetailLoading(false); });
    return () => { mounted = false; };
  }, [selectedCustomerId, detailPage]);

  function submitSearch(event) {
    event.preventDefault();
    setSearchQuery(searchInput.trim());
    setPage(0);
    clearSelection(setSelectedCustomerId, setDetail, setDetailError);
  }

  function clearSearch() {
    setSearchInput("");
    setSearchQuery("");
    setPage(0);
    clearSelection(setSelectedCustomerId, setDetail, setDetailError);
  }

  function changeBranch(event) {
    setSelectedBranch(event.target.value);
    setPage(0);
    clearSelection(setSelectedCustomerId, setDetail, setDetailError);
  }

  function selectCustomer(customerId) {
    setSelectedCustomerId(customerId);
    setDetailPage(0);
    setDetail(null);
    setDetailError("");
  }

  if (branchesLoading) return <LoadingState label="載入會員資料…" />;

  return (
    <div className="page-stack">
      <div className="page-heading">
        <span className="eyebrow">MEMBER DIRECTORY</span>
        <h1>會員管理</h1>
        <p>查詢會員目前點數、累積紀錄與各分店的交易明細。</p>
      </div>
      <ErrorMessage message={error} />

      <section className="content-card member-filter-card">
        <form className="member-filters" onSubmit={submitSearch}>
          <label className="field-label member-search-field" htmlFor="member-search">
            會員電話
            <div className="transaction-search-input">
              <Search size={16} aria-hidden="true" />
              <input id="member-search" type="search" inputMode="tel" placeholder="輸入電話片段" value={searchInput} onChange={(event) => setSearchInput(event.target.value)} disabled={loading} />
            </div>
          </label>
          <label className="field-label" htmlFor="member-branch">
            活躍分店
            <select id="member-branch" value={selectedBranch} onChange={changeBranch} disabled={loading}>
              <option value="">所有分店</option>
              {branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
            </select>
          </label>
          <div className="member-filter-actions">
            <button className="button button--primary" type="submit" disabled={loading}><Search size={17} aria-hidden="true" />搜尋會員</button>
            {(searchQuery || selectedBranch) && <button className="button button--secondary" type="button" onClick={clearSearch} disabled={loading}><X size={17} aria-hidden="true" />清除條件</button>}
          </div>
        </form>
      </section>

      <div className="member-layout">
        <section className="content-card member-list-card">
          <div className="content-card__header">
            <div><span className="eyebrow">CUSTOMERS</span><h2>會員清單</h2></div>
            <span className="status-pill status-pill--muted">第 {page + 1} 頁 · {customers.length} 筆</span>
          </div>
          {loading && customers.length === 0 ? <LoadingState label="同步會員資料中…" /> : customers.length === 0 ? <EmptyState title="沒有符合條件的會員" description="請調整分店或電話搜尋條件。" /> : <div className="table-wrap"><table className="data-table member-table"><thead><tr><th>會員電話</th><th>目前點數</th><th>交易筆數</th><th>最近活動</th><th>操作</th></tr></thead><tbody>{customers.map((customer) => { const selected = selectedCustomerId === customer.id; const activate = () => { if (!loading) selectCustomer(customer.id); }; return <tr key={customer.id} className={`member-row ${selected ? "member-row--selected" : ""}`} tabIndex={0} aria-selected={selected} aria-label={`查看 ${customer.phone_display} 的會員明細`} onClick={activate} onKeyDown={(event) => { if ((event.key === "Enter" || event.key === " ") && !loading) { event.preventDefault(); selectCustomer(customer.id); } }}><td><button type="button" className="member-phone-button" onClick={(event) => { event.stopPropagation(); activate(); }} disabled={loading} aria-label={`查看 ${customer.phone_display} 的明細`}><strong>{customer.phone_display}</strong><small>加入於 {formatDate(customer.created_at)}</small></button></td><td className="member-points">{customer.points_balance.toLocaleString()}</td><td>{customer.transaction_count}</td><td>{formatDate(customer.last_transaction_at)}</td><td><button type="button" className="button button--secondary member-detail-button" aria-pressed={selected} onClick={(event) => { event.stopPropagation(); activate(); }} disabled={loading}>查看明細</button></td></tr>; })}</tbody></table></div>}
          <div className="member-pagination"><button className="button button--secondary" type="button" onClick={() => setPage((current) => Math.max(0, current - 1))} disabled={loading || page === 0}><ArrowLeft size={16} aria-hidden="true" />上一頁</button><span>第 {page + 1} 頁</span><button className="button button--secondary" type="button" onClick={() => setPage((current) => current + 1)} disabled={loading || !hasMore}>下一頁<ArrowRight size={16} aria-hidden="true" /></button></div>
        </section>

        <section className="content-card member-detail-card" aria-live="polite">
          <div className="content-card__header"><div><span className="eyebrow">MEMBER PROFILE</span><h2>會員明細</h2></div><span className="member-detail-icon"><UserRound size={20} aria-hidden="true" /></span></div>
          {detailLoading ? <LoadingState label="載入會員明細中…" /> : detailError ? <ErrorMessage message={detailError} /> : !selectedCustomerId ? <EmptyState title="選擇一位會員" description="從左側清單查看目前點數與交易紀錄。" /> : detail ? <CustomerDetail detail={detail} detailPage={detailPage} setDetailPage={setDetailPage} detailLoading={detailLoading} /> : <EmptyState title="找不到會員明細" description="請重新選擇會員，或重新整理清單。" />}
        </section>
      </div>
    </div>
  );
}

function CustomerDetail({ detail, detailPage, setDetailPage, detailLoading }) {
  const customer = detail.customer;
  const transactions = detail.transactions ?? [];
  return <div className="member-detail-body">
    <div className="member-profile"><span className="member-profile__avatar"><UserRound size={24} aria-hidden="true" /></span><div><strong>{customer.phone_display}</strong><small>會員建立於 {formatDate(customer.created_at)}</small></div></div>
    <div className="member-kpis"><div><span>目前點數</span><strong>{customer.points_balance.toLocaleString()}</strong></div><div><span>交易筆數</span><strong>{customer.transaction_count}</strong></div><div><span>最近活動</span><strong>{customer.last_transaction_at ? formatDate(customer.last_transaction_at) : "—"}</strong></div></div>
    <div className="member-detail-heading"><div><span className="eyebrow">POINT ACTIVITY</span><h3>點數紀錄</h3></div><span className="status-pill status-pill--muted">第 {detailPage + 1} 頁</span></div>
    {transactions.length === 0 ? <EmptyState title="尚無點數紀錄" description="這位會員目前沒有可顯示的交易資料。" /> : <div className="table-wrap"><table className="data-table member-detail-table"><thead><tr><th>時間</th><th>分店</th><th>類型</th><th>變動</th><th>餘額</th></tr></thead><tbody>{transactions.map((transaction) => <tr key={transaction.id}><td>{formatDate(transaction.created_at)}</td><td>{transaction.branch_name || "未指定分店"}</td><td><span className={`transaction-type ${transaction.delta > 0 ? "transaction-type--add" : "transaction-type--redeem"}`}>{transaction.delta > 0 ? <ArrowUpRight size={14} aria-hidden="true" /> : <ArrowDownLeft size={14} aria-hidden="true" />}{transactionLabels[transaction.type] ?? transaction.type}</span><small>{transaction.actor_type}</small></td><td className={transaction.delta > 0 ? "text-positive" : "text-negative"}>{transaction.delta > 0 ? "+" : ""}{transaction.delta}</td><td>{transaction.balance_after}</td></tr>)}</tbody></table></div>}
    <div className="member-pagination"><button className="button button--secondary" type="button" onClick={() => setDetailPage((current) => Math.max(0, current - 1))} disabled={detailLoading || detailPage === 0}><ArrowLeft size={16} aria-hidden="true" />上一頁</button><span>第 {detailPage + 1} 頁</span><button className="button button--secondary" type="button" onClick={() => setDetailPage((current) => current + 1)} disabled={detailLoading || !detail.hasMore}>下一頁<ArrowRight size={16} aria-hidden="true" /></button></div>
  </div>;
}
