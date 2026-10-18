import { Copy, Edit3, MapPin, Phone, Plus, RefreshCw, Save, Settings2, Trash2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "../../lib/api.js";
import { ErrorMessage, LoadingState } from "../../components/Brand.jsx";
import { EmptyState } from "./MerchantDashboard.jsx";

const emptyForm = {
  name: "",
  address: "",
  phone: "",
  timezone: "Asia/Taipei",
  isActive: true,
  terminalPin: "",
};

function createPin() {
  return String(Math.floor(1000 + Math.random() * 9000));
}

export default function BranchManagement() {
  const [branches, setBranches] = useState([]);
  const [storeCode, setStoreCode] = useState("----");
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState("");
  const [createdKey, setCreatedKey] = useState("");
  const [copiedKey, setCopiedKey] = useState(false);

  async function loadBranches() {
    setLoading(true);
    try {
      const payload = await api.merchant.branches();
      setStoreCode(payload.storeCode ?? "----");
      setBranches(payload.branches ?? []);
    } catch (loadError) {
      setError(loadError.message ?? "無法載入分店資料");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadBranches(); }, []);

  function openCreate() {
    setEditingId("");
    setForm({ ...emptyForm, terminalPin: createPin() });
    setFormOpen(true);
    setCreatedKey("");
    setCopiedKey(false);
    setError("");
    setMessage("");
  }

  function openEdit(branch) {
    setEditingId(branch.id);
    setForm({
      name: branch.name ?? "",
      address: branch.address ?? "",
      phone: branch.phone ?? "",
      timezone: branch.timezone ?? "Asia/Taipei",
      isActive: branch.is_active !== false,
      terminalPin: "",
    });
    setFormOpen(true);
    setError("");
    setMessage("");
  }

  function closeForm() {
    setFormOpen(false);
    setEditingId("");
    setForm({ ...emptyForm });
  }

  async function saveBranch(event) {
    event.preventDefault();
    if (!form.name.trim()) {
      setError("請輸入分店名稱");
      return;
    }
    if (!editingId && !/^\d{4}$/.test(form.terminalPin)) {
      setError("請輸入 4 位數字的終端登入 PIN");
      return;
    }

    setSaving(true);
    setError("");
    setMessage("");
    const payload = {
      name: form.name.trim(),
      address: form.address.trim(),
      phone: form.phone.trim(),
      timezone: form.timezone.trim() || "Asia/Taipei",
      isActive: form.isActive,
      ...(!editingId ? { terminalPin: form.terminalPin } : {}),
    };
    try {
      if (editingId) {
        await api.merchant.updateBranch(editingId, payload);
        setMessage("分店資料已更新");
      } else {
        const result = await api.merchant.createBranch(payload);
        setCreatedKey(result.key ?? "");
        setCopiedKey(false);
        setMessage("分店已建立，請立即保存終端登入金鑰");
      }
      setFormOpen(false);
      setEditingId("");
      setForm({ ...emptyForm });
      await loadBranches();
    } catch (saveError) {
      setError(saveError.message ?? "儲存分店失敗");
    } finally {
      setSaving(false);
    }
  }

  async function duplicateBranch(branch) {
    setError("");
    setMessage("");
    setSaving(true);
    try {
      const result = await api.merchant.createBranch({
        name: `${branch.name} - 副本`.slice(0, 120),
        address: branch.address ?? "",
        phone: branch.phone ?? "",
        timezone: branch.timezone ?? "Asia/Taipei",
        isActive: branch.is_active !== false,
      });
      setCreatedKey(result.key ?? "");
      setCopiedKey(false);
      setMessage("分店副本已建立，請立即保存終端登入金鑰");
      await loadBranches();
    } catch (copyError) {
      setError(copyError.message ?? "複製分店失敗");
    } finally {
      setSaving(false);
    }
  }

  async function copyCreatedKey() {
    if (!createdKey) return;
    try {
      await navigator.clipboard.writeText(createdKey);
      setCopiedKey(true);
      setMessage("終端登入金鑰已複製到剪貼簿");
    } catch {
      setMessage("請手動複製畫面上的終端登入金鑰");
    }
  }

  async function deleteBranch(branch) {
    if (!window.confirm(`確定要刪除「${branch.name}」嗎？有交易紀錄的分店只能停用。`)) return;
    setDeletingId(branch.id);
    setError("");
    setMessage("");
    try {
      await api.merchant.deleteBranch(branch.id);
      setMessage("分店已刪除");
      if (editingId === branch.id) closeForm();
      await loadBranches();
    } catch (deleteError) {
      setError(deleteError.message ?? "刪除分店失敗");
    } finally {
      setDeletingId("");
    }
  }

  if (loading) return <LoadingState label="載入分店資料…" />;

  return (
    <div className="page-stack">
      <div className="page-heading branch-page-heading"><div><span className="eyebrow">BRANCH MANAGEMENT</span><h1>分店管理</h1><p>建立與維護營運分店的基本資料；終端登入金鑰格式為商家代碼加 4 位數字。</p><div className="branch-store-code">商家代碼 <code>{storeCode}</code></div></div>{!formOpen && <button className="button button--primary" type="button" onClick={openCreate} disabled={saving}><Plus size={17} aria-hidden="true" />新增分店</button>}</div>
      <ErrorMessage message={error} />
      {message && <div className="status-message status-message--success" role="status">{message}</div>}
      {createdKey && <div className="terminal-key-reveal branch-terminal-key-reveal" role="status"><strong>新分店終端登入金鑰（只顯示這一次）</strong><div className="terminal-key-value"><code>{createdKey}</code><button className="button button--success" type="button" onClick={copyCreatedKey}>{copiedKey ? <Copy size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />}{copiedKey ? "已複製" : "複製金鑰"}</button></div><p>格式：{storeCode} + 4 位數字；離開或重新整理後無法再次查看完整內容。</p></div>}

      {formOpen && <section className="content-card branch-form-card"><div className="content-card__header"><div><span className="eyebrow">{editingId ? "EDIT BRANCH" : "NEW BRANCH"}</span><h2>{editingId ? "編輯分店" : "建立分店"}</h2></div><button className="icon-button" type="button" onClick={closeForm} aria-label="關閉分店表單" disabled={saving}><X size={19} aria-hidden="true" /></button></div><form className="branch-form" onSubmit={saveBranch}><label className="field-label" htmlFor="branch-name">分店名稱<input id="branch-name" value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} maxLength={120} required disabled={saving} placeholder="例如：台北信義店" /></label><label className="field-label" htmlFor="branch-address">地址<input id="branch-address" value={form.address} onChange={(event) => setForm((current) => ({ ...current, address: event.target.value }))} maxLength={240} disabled={saving} placeholder="營運地址" /></label><label className="field-label" htmlFor="branch-phone">聯絡電話<input id="branch-phone" value={form.phone} onChange={(event) => setForm((current) => ({ ...current, phone: event.target.value }))} maxLength={60} disabled={saving} placeholder="門市電話" /></label><label className="field-label" htmlFor="branch-timezone">時區<input id="branch-timezone" value={form.timezone} onChange={(event) => setForm((current) => ({ ...current, timezone: event.target.value }))} maxLength={80} disabled={saving} /></label>{!editingId && <label className="field-label" htmlFor="branch-terminal-pin">終端登入 PIN（4 位數字）<div className="branch-terminal-pin"><span>{storeCode}</span><input id="branch-terminal-pin" inputMode="numeric" value={form.terminalPin} onChange={(event) => setForm((current) => ({ ...current, terminalPin: event.target.value.replace(/\D/g, "").slice(0, 4) }))} maxLength={4} required disabled={saving} placeholder="1234" /><button className="branch-pin-refresh" type="button" onClick={() => setForm((current) => ({ ...current, terminalPin: createPin() }))} disabled={saving} aria-label="重新產生 PIN" title="重新產生 PIN"><RefreshCw size={17} aria-hidden="true" /></button></div><small>完整登入金鑰：{storeCode}{form.terminalPin || "••••"}</small></label>}<label className="checkbox-label branch-active-checkbox" htmlFor="branch-active"><input id="branch-active" type="checkbox" checked={form.isActive} onChange={(event) => setForm((current) => ({ ...current, isActive: event.target.checked }))} disabled={saving} />分店目前營運中</label><div className="branch-form-actions"><button className="button button--secondary" type="button" onClick={closeForm} disabled={saving}>取消</button><button className="button button--primary" type="submit" disabled={saving}><Save size={17} aria-hidden="true" />{saving ? "儲存中…" : "儲存分店"}</button></div></form></section>}

      {branches.length === 0 ? <section className="content-card"><EmptyState title="尚未建立分店" description="建立第一間分店後，就會產生商家代碼加 4 位數字的終端登入金鑰。" /></section> : <div className="branch-grid">{branches.map((branch) => <BranchCard key={branch.id} branch={branch} busy={saving || deletingId === branch.id} onEdit={openEdit} onCopy={duplicateBranch} onDelete={deleteBranch} />)}</div>}
    </div>
  );
}

function BranchCard({ branch, busy, onEdit, onCopy, onDelete }) {
  return <article className="branch-card"><div className="branch-card__top"><span className="branch-card__icon"><Settings2 size={20} aria-hidden="true" /></span><div className="branch-card__actions"><button className="branch-icon-button" type="button" onClick={() => onCopy(branch)} disabled={busy} aria-label={`複製${branch.name}`} title="複製分店"><Copy size={17} aria-hidden="true" /></button><button className="branch-icon-button" type="button" onClick={() => onEdit(branch)} disabled={busy} aria-label={`編輯${branch.name}`} title="編輯分店"><Edit3 size={17} aria-hidden="true" /></button><button className="branch-icon-button branch-icon-button--danger" type="button" onClick={() => onDelete(branch)} disabled={busy} aria-label={`刪除${branch.name}`} title="刪除分店"><Trash2 size={17} aria-hidden="true" /></button></div></div><div className="branch-card__heading"><h2>{branch.name}</h2><span className={`status-pill ${branch.is_active ? "status-pill--active" : "status-pill--muted"}`}>{branch.is_active ? "營運中" : "已停用"}</span></div><p><MapPin size={16} aria-hidden="true" />{branch.address || "未提供地址"}</p><p><Phone size={16} aria-hidden="true" />{branch.phone || "未提供電話"}</p><div className="branch-card__footer"><span>主題：{branch.theme_color || "teal"}</span><span>時區：{branch.timezone || "Asia/Taipei"}</span></div></article>;
}
