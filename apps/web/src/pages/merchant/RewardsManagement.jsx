import { useEffect, useRef, useState } from "react";
import { ArrowDownCircle, ArrowUpCircle, Pencil, Plus, RefreshCw, Trash2, X, Zap } from "lucide-react";
import { api } from "../../lib/api.js";
import { ErrorMessage, LoadingState } from "../../components/Brand.jsx";
import { EmptyState } from "./MerchantDashboard.jsx";

const emptyForm = (type) => ({
  label: "",
  valuePoints: "",
  displayOrder: "0",
  type,
});

function sortOptions(items) {
  return [...items].sort((left, right) => left.display_order - right.display_order || left.label.localeCompare(right.label, "zh-TW"));
}

export default function RewardsManagement() {
  const [branches, setBranches] = useState([]);
  const [selectedBranch, setSelectedBranch] = useState("");
  const [options, setOptions] = useState([]);
  const [activeType, setActiveType] = useState("add");
  const [form, setForm] = useState(() => emptyForm("add"));
  const [editingId, setEditingId] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [formError, setFormError] = useState("");
  const [loading, setLoading] = useState(true);
  const [optionsLoading, setOptionsLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [limitBusy, setLimitBusy] = useState(false);
  const [deletingId, setDeletingId] = useState("");
  const [togglingId, setTogglingId] = useState("");
  const labelInputRef = useRef(null);

  const selectedBranchData = branches.find((branch) => branch.id === selectedBranch);
  const visibleOptions = options.filter((option) => option.type === activeType);
  const activeCount = visibleOptions.filter((option) => option.is_active).length;

  useEffect(() => {
    let mounted = true;
    api.merchant.branches()
      .then((payload) => {
        if (!mounted) return;
        const nextBranches = payload.branches ?? [];
        setBranches(nextBranches);
        setSelectedBranch(nextBranches[0]?.id ?? "");
      })
      .catch((loadError) => { if (mounted) setError(loadError.message ?? "無法載入分店資料"); })
      .finally(() => { if (mounted) setLoading(false); });
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    if (!selectedBranch) {
      setOptions([]);
      return undefined;
    }

    let mounted = true;
    setOptionsLoading(true);
    setError("");
    api.merchant.loyaltyOptions(selectedBranch)
      .then((payload) => { if (mounted) setOptions(payload.options ?? []); })
      .catch((loadError) => { if (mounted) setError(loadError.message ?? "無法載入兌換項目"); })
      .finally(() => { if (mounted) setOptionsLoading(false); });
    return () => { mounted = false; };
  }, [selectedBranch]);

  function resetForm(type = activeType) {
    setForm(emptyForm(type));
    setEditingId("");
    setFormError("");
  }

  function selectType(type) {
    setActiveType(type);
    resetForm(type);
  }

  function selectBranch(branchId) {
    setSelectedBranch(branchId);
    resetForm(activeType);
    setNotice("");
  }

  function startEditing(option) {
    setActiveType(option.type);
    setEditingId(option.id);
    setForm({
      label: option.label,
      valuePoints: String(option.value_points),
      displayOrder: String(option.display_order ?? 0),
      type: option.type,
    });
    setFormError("");
    window.requestAnimationFrame(() => labelInputRef.current?.focus());
  }

  function updateForm(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function handleSave(event) {
    event.preventDefault();
    setFormError("");
    setNotice("");
    const label = form.label.trim();
    const valuePoints = Number(form.valuePoints);
    const displayOrder = Number(form.displayOrder);
    if (!selectedBranch) {
      setFormError("請先選擇分店");
      return;
    }
    if (!label || label.length > 80) {
      setFormError("請輸入 1 到 80 個字元的顯示標題");
      return;
    }
    if (!Number.isInteger(valuePoints) || valuePoints < 1 || valuePoints > 1_000_000) {
      setFormError("點數數值必須是 1 到 1,000,000 的整數");
      return;
    }
    if (!Number.isInteger(displayOrder) || displayOrder < 0 || displayOrder > 10_000) {
      setFormError("顯示順序必須是 0 到 10,000 的整數");
      return;
    }

    setSaving(true);
    try {
      const payload = { branchId: selectedBranch, type: form.type, label, valuePoints, displayOrder };
      if (!editingId) payload.isActive = true;
      if (editingId) {
        const result = await api.merchant.updateLoyaltyOption(editingId, payload);
        setOptions((current) => sortOptions(current.map((option) => option.id === editingId ? { ...option, ...result.option } : option)));
        setNotice("兌換項目已更新");
      } else {
        const result = await api.merchant.createLoyaltyOption(payload);
        setOptions((current) => sortOptions([...current, result.option]));
        setNotice("兌換項目已新增");
      }
      resetForm(activeType);
    } catch (saveError) {
      setFormError(saveError.message ?? "兌換項目儲存失敗");
    } finally {
      setSaving(false);
    }
  }

  async function handleToggle(option) {
    setTogglingId(option.id);
    setError("");
    setNotice("");
    try {
      const result = await api.merchant.updateLoyaltyOption(option.id, { isActive: !option.is_active });
      setOptions((current) => current.map((item) => item.id === option.id ? { ...item, ...result.option } : item));
      setNotice(result.option.is_active ? "項目已啟用，終端將重新顯示" : "項目已停用，終端不再顯示");
    } catch (toggleError) {
      setError(toggleError.message ?? "項目狀態更新失敗");
    } finally {
      setTogglingId("");
    }
  }

  async function handleDelete(option) {
    if (!window.confirm(`確定要刪除「${option.label}」嗎？刪除後無法復原。`)) return;
    setDeletingId(option.id);
    setError("");
    setNotice("");
    try {
      await api.merchant.deleteLoyaltyOption(option.id);
      setOptions((current) => current.filter((item) => item.id !== option.id));
      if (editingId === option.id) resetForm(activeType);
      setNotice("兌換項目已刪除");
    } catch (deleteError) {
      setError(deleteError.message ?? "兌換項目刪除失敗");
    } finally {
      setDeletingId("");
    }
  }

  async function handleLimitChange(event) {
    if (!selectedBranch) return;
    const dailyRedemptionLimit = Number(event.target.value);
    setLimitBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await api.merchant.updateBranchSettings(selectedBranch, { dailyRedemptionLimit });
      setBranches((current) => current.map((branch) => branch.id === selectedBranch ? { ...branch, ...result.branch } : branch));
      setNotice("每日兌換上限已更新");
    } catch (limitError) {
      setError(limitError.message ?? "每日兌換上限更新失敗");
    } finally {
      setLimitBusy(false);
    }
  }

  if (loading) return <LoadingState label="載入兌換項目…" />;

  return (
    <div className="page-stack">
      <div className="page-heading">
        <span className="eyebrow">REWARD OPTIONS</span>
        <h1>忠誠度方案設定</h1>
        <p>設定各分店終端顯示的集點與兌換選項，修改會即時套用到下一次終端資料讀取。</p>
      </div>
      <ErrorMessage message={error} />
      {notice && <div className="status-message status-message--success" role="status"><strong>完成</strong><span>{notice}</span></div>}

      {branches.length === 0 ? (
        <section className="content-card"><EmptyState title="尚未建立分店" description="完成資料匯入或建立第一間分店後，才能設定專屬的集點與兌換項目。" /></section>
      ) : (
        <>
      <div className="reward-toolbar">
            <label className="field-label field-label--inline" htmlFor="reward-branch">管理分店
              <select id="reward-branch" value={selectedBranch} onChange={(event) => selectBranch(event.target.value)} disabled={saving || limitBusy}>
                {branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
              </select>
            </label>
            <label className="field-label field-label--inline" htmlFor="reward-limit">每日兌換上限
              <select id="reward-limit" value={selectedBranchData?.daily_redemption_limit ?? 2} onChange={handleLimitChange} disabled={limitBusy || !selectedBranch}>
                {Array.from({ length: 11 }, (_item, index) => <option key={index} value={index}>{index === 0 ? "0（不限次數）" : `${index} 次`}</option>)}
              </select>
            </label>
          </div>

          <div className="reward-tabs" role="tablist" aria-label="方案類型">
            <button className={`reward-tab ${activeType === "add" ? "reward-tab--active reward-tab--add" : ""}`} type="button" role="tab" aria-selected={activeType === "add"} onClick={() => selectType("add")}><ArrowUpCircle size={18} aria-hidden="true" />集點規則</button>
            <button className={`reward-tab ${activeType === "redeem" ? "reward-tab--active reward-tab--redeem" : ""}`} type="button" role="tab" aria-selected={activeType === "redeem"} onClick={() => selectType("redeem")}><ArrowDownCircle size={18} aria-hidden="true" />兌換獎勵</button>
          </div>

          <div className="reward-layout">
            <form className={`content-card reward-form-card reward-form-card--${activeType}`} onSubmit={handleSave}>
              <div className="reward-form-card__header"><span className="reward-card__icon"><Zap size={19} /></span><div><span className="eyebrow">{editingId ? "EDIT OPTION" : "NEW OPTION"}</span><h2>{editingId ? "編輯方案" : `新增${activeType === "add" ? "集點" : "兌換"}方案`}</h2></div></div>
              <label className="field-label" htmlFor="reward-label">顯示標題
                <input ref={labelInputRef} id="reward-label" maxLength={80} placeholder={activeType === "add" ? "例：購買拿鐵一杯" : "例：免費換伯爵茶"} value={form.label} onChange={(event) => updateForm("label", event.target.value)} disabled={saving} required />
              </label>
              <div className="reward-form-grid">
                <label className="field-label" htmlFor="reward-points">點數數值
                  <input id="reward-points" type="number" min="1" max="1000000" value={form.valuePoints} onChange={(event) => updateForm("valuePoints", event.target.value)} disabled={saving} required />
                </label>
                <label className="field-label" htmlFor="reward-order">顯示順序
                  <input id="reward-order" type="number" min="0" max="10000" value={form.displayOrder} onChange={(event) => updateForm("displayOrder", event.target.value)} disabled={saving} />
                </label>
              </div>
              <p className="form-help form-help--left">建議標題保持簡短，方便門市人員在平板終端快速辨識。</p>
              {formError && <div className="inline-error" role="alert">{formError}</div>}
              <div className="settings-actions"><button className="button button--primary" type="submit" disabled={saving || !selectedBranch}><Plus size={17} aria-hidden="true" />{saving ? "儲存中…" : editingId ? "儲存變更" : `加入${activeType === "add" ? "集點" : "兌換"}選單`}</button>{editingId && <button className="button button--secondary" type="button" onClick={() => resetForm(activeType)} disabled={saving}><X size={17} aria-hidden="true" />取消編輯</button>}</div>
            </form>

            <section className="content-card reward-list-card">
              <div className="content-card__header"><div><span className="eyebrow">{activeType === "add" ? "COLLECTION RULES" : "REDEMPTION REWARDS"}</span><h2>{activeType === "add" ? "所有集點方案" : "所有兌換獎勵"}</h2></div><span className="status-pill status-pill--muted">啟用 {activeCount} / {visibleOptions.length}</span></div>
              {optionsLoading ? <LoadingState label="載入方案中…" /> : visibleOptions.length === 0 ? <EmptyState title="尚無任何項目" description={`在左側新增第一個${activeType === "add" ? "集點" : "兌換"}方案。`} /> : <div className="table-wrap"><table className="data-table reward-table"><thead><tr><th>顯示名稱</th><th>點數</th><th>順序</th><th>狀態</th><th>操作</th></tr></thead><tbody>{visibleOptions.map((option) => <tr key={option.id}><td><strong>{option.label}</strong><small>{option.type === "add" ? "累積點數" : "扣除點數"}</small></td><td className={option.type === "add" ? "text-positive" : "text-negative"}>{option.type === "add" ? "+" : "-"}{option.value_points} 點</td><td>{option.display_order}</td><td><span className={`status-pill ${option.is_active ? "status-pill--active" : "status-pill--muted"}`}>{option.is_active ? "啟用中" : "已停用"}</span></td><td><div className="reward-actions"><button className="button button--secondary" type="button" onClick={() => startEditing(option)} disabled={saving || deletingId !== "" || togglingId !== ""}><Pencil size={15} aria-hidden="true" />編輯</button><button className={`button ${option.is_active ? "button--danger" : "button--success"}`} type="button" onClick={() => handleToggle(option)} disabled={saving || deletingId !== "" || togglingId !== ""}>{togglingId === option.id ? <RefreshCw size={15} className="spin" aria-hidden="true" /> : option.is_active ? "停用" : "啟用"}</button><button className="icon-button icon-button--danger" type="button" aria-label={`刪除${option.label}`} title={`刪除${option.label}`} onClick={() => handleDelete(option)} disabled={deletingId !== "" || saving || togglingId !== ""}>{deletingId === option.id ? <RefreshCw size={16} className="spin" aria-hidden="true" /> : <Trash2 size={16} aria-hidden="true" />}</button></div></td></tr>)}</tbody></table></div>}
            </section>
          </div>
        </>
      )}
    </div>
  );
}
