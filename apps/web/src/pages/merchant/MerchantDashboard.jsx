import { Activity, ArrowDownLeft, ArrowUpRight, CircleDollarSign, Download, FileText, Monitor, TrendingUp, Users } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ErrorMessage, LoadingState } from "../../components/Brand.jsx";
import { api } from "../../lib/api.js";

const transactionLabels = {
  add: "發放",
  redeem: "兌換",
  manual_redeem: "手動兌換",
  adjustment: "調整",
};

function dateInputValue(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function dateRangeFor(filter, customRange) {
  if (filter === "custom") {
    if (!customRange.start || !customRange.end) return { error: "請選擇完整的自訂日期區間" };
    if (customRange.start > customRange.end) return { error: "自訂日期的開始日不能晚於結束日" };
    return {
      dateFrom: new Date(`${customRange.start}T00:00:00`).toISOString(),
      dateTo: new Date(`${customRange.end}T23:59:59.999`).toISOString(),
      granularity: customRange.start === customRange.end ? "hour" : "day",
    };
  }

  const now = new Date();
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  if (filter === "week") {
    const daysSinceMonday = (now.getDay() + 6) % 7;
    start.setDate(start.getDate() - daysSinceMonday);
  }
  if (filter === "month") start.setDate(1);
  return {
    dateFrom: start.toISOString(),
    dateTo: now.toISOString(),
    granularity: filter === "today" ? "hour" : "day",
  };
}

function formatDate(value) {
  return value ? new Date(value).toLocaleString("zh-TW") : "—";
}

function formatBucket(value, granularity) {
  const date = new Date(value);
  return granularity === "hour"
    ? date.toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit" })
    : date.toLocaleDateString("zh-TW", { month: "numeric", day: "numeric" });
}

function downloadCSV(data, filename) {
  if (!data.length) return;
  const headers = Object.keys(data[0]);
  const rows = data.map((row) => headers.map((key) => {
    const value = row[key];
    return typeof value === "string" ? `"${value.replaceAll('"', '""')}"` : value;
  }).join(","));
  const blob = new Blob([`\uFEFF${headers.join(",")}\n${rows.join("\n")}`], { type: "text/csv;charset=utf-8;" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
}

export default function MerchantDashboard() {
  const navigate = useNavigate();
  const [branches, setBranches] = useState([]);
  const [selectedBranch, setSelectedBranch] = useState("");
  const [dateFilter, setDateFilter] = useState("today");
  const [customRange, setCustomRange] = useState({ start: dateInputValue(), end: dateInputValue() });
  const [dashboard, setDashboard] = useState(null);
  const [error, setError] = useState("");
  const [branchesLoading, setBranchesLoading] = useState(true);
  const [loading, setLoading] = useState(true);

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
      setLoading(false);
      return undefined;
    }

    let mounted = true;
    setLoading(true);
    setError("");
    api.merchant.dashboard({
      branchId: selectedBranch || undefined,
      dateFrom: range.dateFrom,
      dateTo: range.dateTo,
      granularity: range.granularity,
    })
      .then((payload) => { if (mounted) setDashboard(payload); })
      .catch((loadError) => { if (mounted) setError(loadError.message ?? "無法載入 Dashboard 資料"); })
      .finally(() => { if (mounted) setLoading(false); });
    return () => { mounted = false; };
  }, [selectedBranch, dateFilter, customRange.start, customRange.end]);

  const chartMax = useMemo(() => Math.max(1, ...(dashboard?.chart ?? []).map((item) => Number(item.points ?? 0))), [dashboard?.chart]);
  const stats = dashboard?.stats;

  function exportRankings() {
    downloadCSV((dashboard?.memberRankings ?? []).map((member) => ({
      會員電話: member.phone_display,
      期間累積: member.accumulated,
      期間兌換: member.redeemed,
      目前點數: member.points_balance,
      交易筆數: member.transaction_count,
      最近活動: formatDate(member.last_seen),
    })), `member-rankings-${dateInputValue()}.csv`);
  }

  function exportBranches() {
    downloadCSV((dashboard?.branchSummary ?? []).map((branch) => ({
      分店: branch.branch_name,
      發放點數: branch.issued,
      兌換點數: branch.redeemed,
      不重複會員: branch.unique_members,
      交易筆數: branch.transaction_count,
    })), `branch-summary-${dateInputValue()}.csv`);
  }

  if (branchesLoading && !dashboard) return <LoadingState label="載入營運 Dashboard…" />;

  return (
    <div className="page-stack">
      <div className="page-heading dashboard-page-heading">
        <div><span className="eyebrow">MERCHANT CONSOLE</span><h1>營運 Dashboard</h1><p>掌握會員成長、點數流動與分店活動的最新狀態。</p></div>
        <div className="dashboard-toolbar">
          {dateFilter === "custom" && <div className="dashboard-date-range"><label className="field-label" htmlFor="dashboard-date-from">開始日<input id="dashboard-date-from" type="date" value={customRange.start} onChange={(event) => setCustomRange((current) => ({ ...current, start: event.target.value }))} disabled={loading} /></label><span aria-hidden="true">至</span><label className="field-label" htmlFor="dashboard-date-to">結束日<input id="dashboard-date-to" type="date" value={customRange.end} onChange={(event) => setCustomRange((current) => ({ ...current, end: event.target.value }))} disabled={loading} /></label></div>}
          <label className="field-label" htmlFor="dashboard-date-filter"><span className="sr-only">統計日期</span><select id="dashboard-date-filter" value={dateFilter} onChange={(event) => setDateFilter(event.target.value)} disabled={loading}><option value="today">本日</option><option value="week">本週</option><option value="month">本月</option><option value="custom">自訂區間</option></select></label>
          <label className="field-label" htmlFor="dashboard-branch-filter"><span className="sr-only">統計分店</span><select id="dashboard-branch-filter" value={selectedBranch} onChange={(event) => setSelectedBranch(event.target.value)} disabled={loading}><option value="">所有分店</option>{branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></label>
          <button className="button button--primary dashboard-terminal-button" type="button" onClick={() => navigate("/terminal")}><Monitor size={17} aria-hidden="true" />開啟終端</button>
        </div>
      </div>
      <ErrorMessage message={error} />

      {stats && <section className="metric-grid dashboard-metrics">
        <MetricCard icon={Users} label="會員總數" value={stats.totalCustomers.toLocaleString()} subValue={`期間新增 +${stats.newMembers}`} tone="teal" />
        <MetricCard icon={CircleDollarSign} label="點數發放" value={stats.periodIssued.toLocaleString()} subValue={`累計發放 ${stats.lifetimeIssued.toLocaleString()}`} tone="indigo" />
        <MetricCard icon={TrendingUp} label="點數兌換" value={stats.periodRedeemed.toLocaleString()} subValue={`${stats.redemptionCount} 次兌換`} tone="amber" />
        <MetricCard icon={Activity} label="點數流通率" value={`${stats.burnRate}%`} subValue={`${stats.activeBranches} 間營運分店`} tone="green" />
      </section>}

      <section className="content-card dashboard-chart-card">
        <div className="content-card__header"><div><span className="eyebrow">POINT TREND</span><h2>點數發放趨勢</h2></div><span className="status-pill status-pill--muted">{stats?.periodAddCount ?? 0} 筆發放</span></div>
        {!dashboard ? <LoadingState label="同步統計資料中…" /> : dashboard.chart.length === 0 ? <EmptyState title="目前區間沒有發放紀錄" description="切換日期或分店篩選條件後，這裡會顯示點數趨勢。" /> : <><div className="dashboard-chart" aria-label="點數發放趨勢圖">{dashboard.chart.map((item) => <div className="dashboard-chart__item" key={item.bucket} title={`${formatBucket(item.bucket, dashboard.granularity)}：${item.points.toLocaleString()} 點`}><div className="dashboard-chart__bar-wrap"><div className="dashboard-chart__bar" style={{ height: `${Math.max(8, (item.points / chartMax) * 100)}%` }} aria-hidden="true" /></div><span>{formatBucket(item.bucket, dashboard.granularity)}</span></div>)}</div><table className="sr-only"><caption>點數發放趨勢資料</caption><thead><tr><th>時間</th><th>點數</th></tr></thead><tbody>{dashboard.chart.map((item) => <tr key={`data-${item.bucket}`}><td>{formatBucket(item.bucket, dashboard.granularity)}</td><td>{item.points}</td></tr>)}</tbody></table></>}
      </section>

      <div className="dashboard-lower-grid">
        <section className="content-card">
          <div className="content-card__header"><div><span className="eyebrow">RECENT ACTIVITY</span><h2>近期交易</h2></div><button className="text-link dashboard-link-button" type="button" onClick={() => navigate("/dashboard/transactions")}><FileText size={16} aria-hidden="true" />查看完整明細</button></div>
          {!dashboard || dashboard.recentTransactions.length === 0 ? <EmptyState title="目前沒有交易" description="選擇其他統計區間，或從終端新增第一筆交易。" /> : <div className="table-wrap"><table className="data-table dashboard-table"><thead><tr><th>會員</th><th>類型</th><th>點數</th><th>時間</th></tr></thead><tbody>{dashboard.recentTransactions.map((transaction) => <tr key={transaction.id}><td><strong>{transaction.phone_display}</strong><small>{transaction.branch_name || "未指定分店"}</small></td><td><span className={`transaction-type ${transaction.delta > 0 ? "transaction-type--add" : "transaction-type--redeem"}`}>{transaction.delta > 0 ? <ArrowUpRight size={14} aria-hidden="true" /> : <ArrowDownLeft size={14} aria-hidden="true" />}{transactionLabels[transaction.type] ?? transaction.type}</span></td><td className={transaction.delta > 0 ? "text-positive" : "text-negative"}>{transaction.delta > 0 ? "+" : ""}{transaction.delta}</td><td>{formatDate(transaction.created_at)}</td></tr>)}</tbody></table></div>}
        </section>

        <section className="content-card">
          <div className="content-card__header"><div><span className="eyebrow">MEMBER RANKING</span><h2>會員排行</h2></div><button className="text-link dashboard-link-button" type="button" onClick={exportRankings} disabled={!dashboard?.memberRankings?.length}><Download size={16} aria-hidden="true" />匯出 CSV</button></div>
          {!dashboard || dashboard.memberRankings.length === 0 ? <EmptyState title="目前沒有會員排行" description="選擇有交易的日期區間後，這裡會顯示累積點數排行。" /> : <div className="table-wrap"><table className="data-table dashboard-table"><thead><tr><th>會員</th><th>期間累積</th><th>目前點數</th><th>交易</th></tr></thead><tbody>{dashboard.memberRankings.map((member) => <tr key={member.customer_id}><td><strong>{member.phone_display}</strong><small>最近 {formatDate(member.last_seen)}</small></td><td className="text-positive">+{member.accumulated}</td><td>{member.points_balance}</td><td>{member.transaction_count}</td></tr>)}</tbody></table></div>}
        </section>
      </div>

      {!selectedBranch && <section className="content-card">
        <div className="content-card__header"><div><span className="eyebrow">BRANCH SUMMARY</span><h2>分店摘要</h2></div><button className="text-link dashboard-link-button" type="button" onClick={exportBranches} disabled={!dashboard?.branchSummary?.length}><Download size={16} aria-hidden="true" />匯出 CSV</button></div>
        {!dashboard || dashboard.branchSummary.length === 0 ? <EmptyState title="目前沒有分店交易摘要" description="選擇所有分店並指定有交易的日期區間後，這裡會顯示摘要。" /> : <div className="table-wrap"><table className="data-table dashboard-table dashboard-branch-table"><thead><tr><th>分店</th><th>發放點數</th><th>兌換點數</th><th>不重複會員</th><th>交易筆數</th></tr></thead><tbody>{dashboard.branchSummary.map((branch) => <tr key={branch.branch_name}><td><strong>{branch.branch_name}</strong></td><td className="text-positive">{branch.issued}</td><td className="text-negative">{branch.redeemed}</td><td>{branch.unique_members}</td><td>{branch.transaction_count}</td></tr>)}</tbody></table></div>}
      </section>}
    </div>
  );
}

function MetricCard({ icon: Icon, label, value, subValue, tone }) {
  return <div className={`metric-card metric-card--${tone}`}><span className="metric-card__icon"><Icon size={20} aria-hidden="true" /></span><span>{label}</span><strong>{value}</strong><small className="metric-card__subvalue">{subValue}</small></div>;
}

export function EmptyState({ title, description }) {
  return <div className="empty-state"><strong>{title}</strong><p>{description}</p></div>;
}
