import { Edit3, KeyRound, Plus, Save, Search, X } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "../lib/api.js";
import { ErrorMessage, LoadingState } from "../components/Brand.jsx";
import { EmptyState } from "./merchant/MerchantDashboard.jsx";

const PAGE_SIZE = 20;
const emptyForm = {
  email: "",
  password: "",
  storeName: "",
  contactPerson: "",
  contactPhone: "",
  contactAddress: "",
  taxId: "",
  status: "active",
};
const statusLabels = { active: "營運中", inactive: "暫停服務", suspended: "已停權" };

export default function AdminDashboard() {
  const [merchants, setMerchants] = useState([]);
  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [formMode, setFormMode] = useState("");
  const [selectedMerchant, setSelectedMerchant] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [resetPassword, setResetPassword] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    setError("");
    api.admin.merchants({ search: searchQuery || undefined, limit: PAGE_SIZE, offset: page * PAGE_SIZE })
      .then((payload) => {
        if (!mounted) return;
        setMerchants(payload.merchants ?? []);
        setHasMore(Boolean(payload.hasMore));
      })
      .catch((loadError) => { if (mounted) setError(loadError.message ?? "無法載入商家資料"); })
      .finally(() => { if (mounted) setLoading(false); });
    return () => { mounted = false; };
  }, [searchQuery, page]);

  function closeForm() {
    setFormMode("");
    setSelectedMerchant(null);
    setForm({ ...emptyForm });
    setResetPassword("");
  }

  function openCreate() {
    setFormMode("create");
    setSelectedMerchant(null);
    setForm({ ...emptyForm });
    setMessage("");
    setError("");
  }

  function openEdit(merchant) {
    setFormMode("edit");
    setSelectedMerchant(merchant);
    setForm({
      ...emptyForm,
      storeName: merchant.store_name ?? "",
      contactPerson: merchant.contact_person ?? "",
      contactPhone: merchant.contact_phone ?? "",
      contactAddress: merchant.contact_address ?? "",
      taxId: merchant.tax_id ?? "",
      status: merchant.status ?? "active",
    });
    setMessage("");
    setError("");
  }

  function openReset(merchant) {
    setFormMode("reset");
    setSelectedMerchant(merchant);
    setResetPassword("");
    setMessage("");
    setError("");
  }

  async function submitForm(event) {
    event.preventDefault();
    setSaving(true);
    setError("");
    setMessage("");
    try {
      if (formMode === "create") {
        await api.admin.createMerchant(form);
        setMessage("商家帳號已建立");
      } else if (formMode === "edit" && selectedMerchant) {
        await api.admin.updateMerchant(selectedMerchant.id, {
          storeName: form.storeName,
          contactPerson: form.contactPerson,
          contactPhone: form.contactPhone,
          contactAddress: form.contactAddress,
          taxId: form.taxId,
          status: form.status,
        });
        setMessage("商家資料已更新");
      }
      closeForm();
      setPage(0);
      await reloadMerchants();
    } catch (saveError) {
      setError(saveError.message ?? "儲存商家資料失敗");
    } finally {
      setSaving(false);
    }
  }

  async function submitReset(event) {
    event.preventDefault();
    if (!selectedMerchant) return;
    setSaving(true);
    setError("");
    setMessage("");
    try {
      await api.admin.resetMerchantPassword(selectedMerchant.id, resetPassword);
      setMessage("商家密碼已重設，既有登入工作階段已撤銷");
      closeForm();
    } catch (resetError) {
      setError(resetError.message ?? "重設密碼失敗");
    } finally {
      setSaving(false);
    }
  }

  async function reloadMerchants() {
    const payload = await api.admin.merchants({ search: searchQuery || undefined, limit: PAGE_SIZE, offset: page * PAGE_SIZE });
    setMerchants(payload.merchants ?? []);
    setHasMore(Boolean(payload.hasMore));
  }

  function submitSearch(event) {
    event.preventDefault();
    setSearchQuery(searchInput.trim());
    setPage(0);
  }

  function clearSearch() {
    setSearchInput("");
    setSearchQuery("");
    setPage(0);
  }

  if (loading && merchants.length === 0) return <LoadingState label="載入商家管理資料…" />;

  return (
    <div className="page-stack">
      <div className="page-heading admin-page-heading"><div><span className="eyebrow">SUPER ADMIN</span><h1>核心商家管理</h1><p>建立商家帳號、維護聯絡資料與管理服務狀態。</p></div><button className="button button--primary" type="button" onClick={openCreate} disabled={saving}><Plus size={17} aria-hidden="true" />建立商家</button></div>
      <ErrorMessage message={error} />
      {message && <div className="status-message status-message--success" role="status">{message}</div>}

      {formMode === "create" && <MerchantForm mode="create" form={form} setForm={setForm} saving={saving} onSubmit={submitForm} onClose={closeForm} />}
      {formMode === "edit" && selectedMerchant && <MerchantForm mode="edit" form={form} setForm={setForm} saving={saving} onSubmit={submitForm} onClose={closeForm} merchant={selectedMerchant} />}
      {formMode === "reset" && selectedMerchant && <section className="content-card admin-form-card"><div className="content-card__header"><div><span className="eyebrow">PASSWORD RESET</span><h2>重設商家密碼</h2></div><button className="icon-button" type="button" onClick={closeForm} aria-label="關閉重設密碼表單" disabled={saving}><X size={19} aria-hidden="true" /></button></div><form className="admin-reset-form" onSubmit={submitReset}><p>帳號：<strong>{selectedMerchant.owner_email || "未設定 Email"}</strong></p><label className="field-label" htmlFor="admin-reset-password">新密碼<input id="admin-reset-password" type="password" minLength={12} value={resetPassword} onChange={(event) => setResetPassword(event.target.value)} required disabled={saving} autoComplete="new-password" /></label><div className="admin-form-actions"><button className="button button--secondary" type="button" onClick={closeForm} disabled={saving}>取消</button><button className="button button--primary" type="submit" disabled={saving}><KeyRound size={17} aria-hidden="true" />{saving ? "處理中…" : "重設密碼"}</button></div></form></section>}

      <section className="content-card admin-list-card"><div className="admin-list-toolbar"><div><span className="eyebrow">MERCHANTS</span><h2>合作商家列表</h2></div><form className="admin-search" onSubmit={submitSearch}><label className="sr-only" htmlFor="admin-merchant-search">搜尋商家</label><Search size={16} aria-hidden="true" /><input id="admin-merchant-search" type="search" placeholder="搜尋品牌、Email、統編或代碼" value={searchInput} onChange={(event) => setSearchInput(event.target.value)} disabled={loading} /><button className="button button--primary" type="submit" disabled={loading}>搜尋</button>{searchQuery && <button className="button button--secondary" type="button" onClick={clearSearch} disabled={loading}>清除</button>}</form></div>{merchants.length === 0 ? <EmptyState title="目前沒有符合條件的商家" description="建立第一個本機測試商家後，這裡會顯示管理資料。" /> : <div className="table-wrap"><table className="data-table admin-table"><thead><tr><th>商家</th><th>帳號</th><th>規模</th><th>狀態</th><th>操作</th></tr></thead><tbody>{merchants.map((merchant) => <tr key={merchant.id}><td><strong>{merchant.store_name}</strong><small>代碼 {merchant.store_code} · 建立於 {new Date(merchant.created_at).toLocaleDateString("zh-TW")}</small></td><td><strong>{merchant.owner_email || "未設定 Email"}</strong><small>{merchant.contact_person || "未設定聯絡人"}</small></td><td>{merchant.branch_count} 分店 · {merchant.customer_count} 會員<small>{merchant.transaction_count} 筆交易</small></td><td><span className={`status-pill admin-status--${merchant.status}`}>{statusLabels[merchant.status] ?? merchant.status}</span></td><td><div className="admin-action-buttons"><button className="admin-icon-button" type="button" onClick={() => openEdit(merchant)} aria-label={`編輯${merchant.store_name}`} title="編輯商家"><Edit3 size={17} aria-hidden="true" /></button><button className="admin-icon-button" type="button" onClick={() => openReset(merchant)} aria-label={`重設${merchant.store_name}密碼`} title="重設密碼"><KeyRound size={17} aria-hidden="true" /></button></div></td></tr>)}</tbody></table></div>}<div className="member-pagination"><button className="button button--secondary" type="button" onClick={() => setPage((current) => Math.max(0, current - 1))} disabled={loading || page === 0}>上一頁</button><span>第 {page + 1} 頁</span><button className="button button--secondary" type="button" onClick={() => setPage((current) => current + 1)} disabled={loading || !hasMore}>下一頁</button></div></section>
    </div>
  );
}

function MerchantForm({ mode, form, setForm, saving, onSubmit, onClose, merchant }) {
  const isCreate = mode === "create";
  return <section className="content-card admin-form-card"><div className="content-card__header"><div><span className="eyebrow">{isCreate ? "NEW MERCHANT" : "EDIT MERCHANT"}</span><h2>{isCreate ? "建立商家帳號" : `編輯${merchant.store_name}`}</h2></div><button className="icon-button" type="button" onClick={onClose} aria-label="關閉商家表單" disabled={saving}><X size={19} aria-hidden="true" /></button></div><form className="admin-form" onSubmit={onSubmit}><label className="field-label" htmlFor="admin-store-name">品牌名稱<input id="admin-store-name" value={form.storeName} onChange={(event) => setForm((current) => ({ ...current, storeName: event.target.value }))} maxLength={120} required disabled={saving} /></label>{isCreate ? <label className="field-label" htmlFor="admin-email">登入 Email<input id="admin-email" type="email" value={form.email} onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))} required disabled={saving} autoComplete="username" /></label> : <label className="field-label" htmlFor="admin-email-readonly">登入 Email<input id="admin-email-readonly" value={merchant.owner_email || "未設定"} readOnly disabled /></label>}<label className="field-label" htmlFor="admin-tax-id">統一編號<input id="admin-tax-id" inputMode="numeric" pattern="[0-9]{8}" maxLength={8} value={form.taxId} onChange={(event) => setForm((current) => ({ ...current, taxId: event.target.value.replace(/\D/g, "").slice(0, 8) }))} disabled={saving} placeholder="8 位數字，可留空" /></label><label className="field-label" htmlFor="admin-contact-person">聯絡人<input id="admin-contact-person" value={form.contactPerson} onChange={(event) => setForm((current) => ({ ...current, contactPerson: event.target.value }))} maxLength={120} disabled={saving} /></label><label className="field-label" htmlFor="admin-contact-phone">聯絡電話<input id="admin-contact-phone" value={form.contactPhone} onChange={(event) => setForm((current) => ({ ...current, contactPhone: event.target.value }))} maxLength={60} disabled={saving} /></label><label className="field-label admin-form-wide" htmlFor="admin-contact-address">聯絡地址<input id="admin-contact-address" value={form.contactAddress} onChange={(event) => setForm((current) => ({ ...current, contactAddress: event.target.value }))} maxLength={240} disabled={saving} /></label>{isCreate && <label className="field-label" htmlFor="admin-password">初始密碼<input id="admin-password" type="password" minLength={12} value={form.password} onChange={(event) => setForm((current) => ({ ...current, password: event.target.value }))} required disabled={saving} autoComplete="new-password" /></label>}<label className="field-label" htmlFor="admin-status">服務狀態<select id="admin-status" value={form.status} onChange={(event) => setForm((current) => ({ ...current, status: event.target.value }))} disabled={saving}><option value="active">營運中</option><option value="inactive">暫停服務</option><option value="suspended">已停權</option></select></label><div className="admin-form-actions"><button className="button button--secondary" type="button" onClick={onClose} disabled={saving}>取消</button><button className="button button--primary" type="submit" disabled={saving}><Save size={17} aria-hidden="true" />{saving ? "儲存中…" : isCreate ? "建立商家" : "儲存變更"}</button></div></form></section>;
}
