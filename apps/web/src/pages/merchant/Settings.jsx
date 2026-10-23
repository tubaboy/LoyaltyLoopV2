import { useEffect, useRef, useState } from "react";
import { AlertCircle, Ban, Check, Copy, ImagePlus, KeyRound, Monitor, Palette, Save, ShieldCheck, Sparkles, Timer, UploadCloud, Volume2 } from "lucide-react";
import { api } from "../../lib/api.js";
import { ErrorMessage, LoadingState } from "../../components/Brand.jsx";

const imageKindLabels = {
  logo: "分店 Logo",
  screensaver: "待機畫面",
};

const soundOptions = [
  { key: "collection", kind: "collection_sound", assetField: "collection_sound_asset_id", nameField: "collection_sound_name", label: "集點音效", fallback: "coin.mp3" },
  { key: "redemption", kind: "redemption_sound", assetField: "redemption_sound_asset_id", nameField: "redemption_sound_name", label: "兌換音效", fallback: "celebration.mp3" },
];

const defaultSettingsForm = {
  name: "",
  address: "",
  phone: "",
  timezone: "Asia/Taipei",
  dailyRedemptionLimit: "2",
  themeColor: "teal",
  resetInterval: "10",
  reminderInterval: "10",
  pointCollectionEffect: "shower",
  redemptionEffect: "confetti",
  screensaverTimeout: "0",
  enableConfetti: true,
  enableSound: true,
};

const collectionEffects = ["shower", "flip"];
const redemptionEffects = ["confetti", "balloons"];
const standardThemeColors = ["teal", "indigo", "amber", "rose"];
const resetIntervalOptions = [0, 5, 10, 15, 30];
const reminderIntervalOptions = [0, 5, 10, 15, 30];
const screensaverTimeoutOptions = [0, 10, 30, 60, 120, 300];

const effectLabels = {
  shower: "金幣海",
  confetti: "豪華灑花",
  flip: "單幣翻轉",
  balloons: "氣球升空",
};

function SettingsSectionHeading({ icon: Icon, eyebrow, title, description, tone = "teal" }) {
  return (
    <div className="settings-section-heading">
      <span className={`settings-section-heading__icon settings-section-heading__icon--${tone}`}><Icon size={21} aria-hidden="true" /></span>
      <div>
        <span className="eyebrow">{eyebrow}</span>
        <h2>{title}</h2>
        {description && <p>{description}</p>}
      </div>
    </div>
  );
}

function valueOptions(values, current) {
  return Array.from(new Set([...(current && !values.includes(current) ? [current] : []), ...values]));
}

function AssetPreview({ label, variant, assetId, previewUrl, loading }) {
  const status = loading && assetId ? "載入預覽中…" : assetId && previewUrl ? "已上傳" : assetId ? "預覽載入失敗" : "尚未上傳";
  return (
    <div className="asset-preview">
      <div className="asset-preview__header"><strong>{label}</strong><span className="status-pill status-pill--muted">{status}</span></div>
      <div className={`asset-preview__canvas asset-preview__canvas--${variant}`}>
        {previewUrl ? <img src={previewUrl} alt={`${label}預覽`} /> : <span className="asset-preview__placeholder">{loading && assetId ? "載入預覽中…" : assetId ? "目前圖片無法顯示" : "尚未上傳圖片"}</span>}
      </div>
    </div>
  );
}

export default function Settings() {
  const [branches, setBranches] = useState([]);
  const [storeCode, setStoreCode] = useState("----");
  const [selectedBranch, setSelectedBranch] = useState("");
  const [settingsForm, setSettingsForm] = useState(defaultSettingsForm);
  const [kind, setKind] = useState("logo");
  const [file, setFile] = useState(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [settingsError, setSettingsError] = useState("");
  const [settingsNotice, setSettingsNotice] = useState("");
  const [terminalError, setTerminalError] = useState("");
  const [terminalNotice, setTerminalNotice] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [passwordNotice, setPasswordNotice] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [generatedKey, setGeneratedKey] = useState("");
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [previewUrls, setPreviewUrls] = useState({ logo: "", screensaver: "" });
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState("");
  const [soundFiles, setSoundFiles] = useState({ collection: null, redemption: null });
  const [soundDraftUrls, setSoundDraftUrls] = useState({ collection: "", redemption: "" });
  const [soundPreviewUrls, setSoundPreviewUrls] = useState({ collection: "", redemption: "" });
  const [soundPreviewLoading, setSoundPreviewLoading] = useState(false);
  const [soundPreviewError, setSoundPreviewError] = useState("");
  const [soundBusy, setSoundBusy] = useState("");
  const [soundError, setSoundError] = useState("");
  const [soundNotice, setSoundNotice] = useState("");
  const [settingsBusy, setSettingsBusy] = useState(false);
  const [terminalBusy, setTerminalBusy] = useState(false);
  const [passwordBusy, setPasswordBusy] = useState(false);
  const fileInputRef = useRef(null);
  const soundFileInputRefs = useRef({});
  const previewUrlsRef = useRef({ logo: "", screensaver: "" });

  const activeBranch = branches.find((branch) => branch.id === selectedBranch);
  const logoAssetId = activeBranch?.logo_asset_id ?? "";
  const screensaverAssetId = activeBranch?.screensaver_asset_id ?? "";
  const collectionSoundAssetId = activeBranch?.collection_sound_asset_id ?? "";
  const redemptionSoundAssetId = activeBranch?.redemption_sound_asset_id ?? "";
  const soundBranchBusy = Boolean(soundBusy);

  function revokePreviewUrls() {
    Object.values(previewUrlsRef.current).forEach((url) => { if (url) URL.revokeObjectURL(url); });
    previewUrlsRef.current = { logo: "", screensaver: "" };
  }

  useEffect(() => {
    api.merchant.branches()
      .then((payload) => {
        const nextBranches = payload.branches ?? [];
        setStoreCode(payload.storeCode ?? "----");
        setBranches(nextBranches);
        setSelectedBranch(nextBranches[0]?.id ?? "");
      })
      .catch((loadError) => setError(loadError.message ?? "無法載入設定"))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!activeBranch) return;
    const pointCollectionEffect = collectionEffects.includes(activeBranch.point_collection_effect)
      ? activeBranch.point_collection_effect
      : "shower";
    const redemptionEffect = redemptionEffects.includes(activeBranch.redemption_effect)
      ? activeBranch.redemption_effect
      : "confetti";
    const screensaverTimeout = Number(activeBranch.screensaver_timeout ?? 0);
    setSettingsForm({
      name: activeBranch.name ?? "",
      address: activeBranch.address ?? "",
      phone: activeBranch.phone ?? "",
      timezone: activeBranch.timezone ?? "Asia/Taipei",
      dailyRedemptionLimit: String(activeBranch.daily_redemption_limit ?? 2),
      themeColor: activeBranch.theme_color ?? "teal",
      resetInterval: String(activeBranch.reset_interval ?? 10),
      reminderInterval: String(activeBranch.reminder_interval ?? 10),
      pointCollectionEffect,
      redemptionEffect,
      screensaverTimeout: String(screensaverTimeoutOptions.includes(screensaverTimeout) ? screensaverTimeout : 0),
      enableConfetti: activeBranch.enable_confetti ?? true,
      enableSound: activeBranch.enable_sound ?? true,
    });
  }, [activeBranch]);

  useEffect(() => {
    setGeneratedKey("");
    setCopied(false);
    setTerminalError("");
    setTerminalNotice("");
  }, [selectedBranch]);

  useEffect(() => {
    setSoundFiles({ collection: null, redemption: null });
    setSoundError("");
    setSoundNotice("");
    Object.values(soundFileInputRefs.current).forEach((input) => {
      if (input) input.value = "";
    });
  }, [selectedBranch]);

  useEffect(() => {
    const nextUrls = { collection: "", redemption: "" };
    soundOptions.forEach(({ key }) => {
      if (soundFiles[key]) nextUrls[key] = URL.createObjectURL(soundFiles[key]);
    });
    setSoundDraftUrls(nextUrls);
    return () => {
      Object.values(nextUrls).forEach((url) => { if (url) URL.revokeObjectURL(url); });
    };
  }, [soundFiles]);

  useEffect(() => {
    let mounted = true;
    revokePreviewUrls();
    setPreviewUrls({ logo: "", screensaver: "" });
    setPreviewError("");

    const assets = [["logo", logoAssetId], ["screensaver", screensaverAssetId]].filter(([, assetId]) => assetId);
    if (assets.length === 0) {
      setPreviewLoading(false);
      return () => { mounted = false; };
    }

    setPreviewLoading(true);
    (async () => {
      const results = await Promise.allSettled(assets.map(async ([assetKind, assetId]) => ({
        assetKind,
        url: URL.createObjectURL(await api.media.download(assetId)),
      })));
      const nextUrls = { logo: "", screensaver: "" };
      let failed = false;
      results.forEach((result) => {
        if (result.status === "fulfilled") nextUrls[result.value.assetKind] = result.value.url;
        else failed = true;
      });

      if (!mounted) {
        Object.values(nextUrls).forEach((url) => { if (url) URL.revokeObjectURL(url); });
        return;
      }

      previewUrlsRef.current = nextUrls;
      setPreviewUrls(nextUrls);
      setPreviewError(failed ? "部分圖片預覽載入失敗，請重新上傳或重新整理。" : "");
      setPreviewLoading(false);
    })();

    return () => {
      mounted = false;
      revokePreviewUrls();
    };
  }, [logoAssetId, screensaverAssetId]);

  useEffect(() => {
    let mounted = true;
    const objectUrls = [];
    setSoundPreviewUrls({ collection: "", redemption: "" });
    setSoundPreviewError("");

    const assets = soundOptions
      .map(({ key, assetField }) => ({ key, assetId: activeBranch?.[assetField] }))
      .filter(({ assetId }) => assetId);
    if (assets.length === 0) {
      setSoundPreviewLoading(false);
      return () => { mounted = false; };
    }

    setSoundPreviewLoading(true);
    (async () => {
      const results = await Promise.allSettled(assets.map(async ({ key, assetId }) => ({
        key,
        url: URL.createObjectURL(await api.media.download(assetId)),
      })));
      const nextUrls = { collection: "", redemption: "" };
      let failed = false;
      results.forEach((result) => {
        if (result.status === "fulfilled") {
          nextUrls[result.value.key] = result.value.url;
          objectUrls.push(result.value.url);
        } else failed = true;
      });

      if (!mounted) {
        objectUrls.forEach((url) => URL.revokeObjectURL(url));
        return;
      }
      setSoundPreviewUrls(nextUrls);
      setSoundPreviewError(failed ? "自訂音效預覽載入失敗；終端仍會使用內建預設音效。" : "");
      setSoundPreviewLoading(false);
    })();

    return () => {
      mounted = false;
      objectUrls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [collectionSoundAssetId, redemptionSoundAssetId]);

  function updateSettingsField(field, value) {
    setSettingsForm((current) => ({ ...current, [field]: value }));
  }

  async function handleUpload(event) {
    event.preventDefault();
    setError("");
    setNotice("");
    if (!selectedBranch || !file) {
      setError("請先選擇分店與圖片檔案");
      return;
    }

    setUploading(true);
    try {
      const payload = await api.merchant.uploadMedia(selectedBranch, kind, file);
      const assetKey = kind === "logo" ? "logo_asset_id" : "screensaver_asset_id";
      setBranches((current) => current.map((branch) => (
        branch.id === selectedBranch ? { ...branch, [assetKey]: payload.asset.id } : branch
      )));
      setNotice(`${imageKindLabels[kind]}已上傳並套用至目前分店`);
      setFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
    } catch (uploadError) {
      setError(uploadError.message ?? "圖片上傳失敗");
    } finally {
      setUploading(false);
    }
  }

  function handleSoundFileChange(kind, selectedFile) {
    setSoundError("");
    setSoundNotice("");
    setSoundFiles((current) => ({ ...current, [kind]: selectedFile }));
  }

  async function handleSoundUpload(kind) {
    const option = soundOptions.find((item) => item.key === kind);
    const selectedFile = soundFiles[kind];
    setSoundError("");
    setSoundNotice("");
    if (!selectedBranch || !selectedFile || !option) {
      setSoundError("請先選擇 MP3 音檔。");
      return;
    }
    if (selectedFile.size > 1024 * 1024) {
      setSoundError("MP3 音檔不可大於 1 MB，請縮短或壓縮後再上傳。");
      return;
    }

    setSoundBusy(kind);
    try {
      const payload = await api.merchant.uploadSound(selectedBranch, option.kind, selectedFile);
      setBranches((current) => current.map((branch) => (
        branch.id === selectedBranch
          ? { ...branch, [option.assetField]: payload.asset.id, [option.nameField]: payload.asset.name ?? selectedFile.name }
          : branch
      )));
      setSoundFiles((current) => ({ ...current, [kind]: null }));
      if (soundFileInputRefs.current[kind]) soundFileInputRefs.current[kind].value = "";
      setSoundNotice(`${option.label}已上傳並套用至目前分店；終端下次載入設定後會使用新音效。`);
    } catch (uploadError) {
      const status = uploadError.status ? `（HTTP ${uploadError.status}）` : "";
      setSoundError(`${uploadError.message ?? `${option.label}上傳失敗`}${status}`);
    } finally {
      setSoundBusy("");
    }
  }

  async function handleSoundReset(kind) {
    const option = soundOptions.find((item) => item.key === kind);
    if (!option || !selectedBranch || !activeBranch?.[option.assetField]) return;
    if (!window.confirm(`將「${option.label}」恢復為系統內建預設音效？`)) return;

    setSoundError("");
    setSoundNotice("");
    setSoundBusy(kind);
    try {
      await api.merchant.resetSound(selectedBranch, option.kind);
      setBranches((current) => current.map((branch) => (
        branch.id === selectedBranch
          ? { ...branch, [option.assetField]: null, [option.nameField]: null }
          : branch
      )));
      setSoundFiles((current) => ({ ...current, [kind]: null }));
      if (soundFileInputRefs.current[kind]) soundFileInputRefs.current[kind].value = "";
      setSoundNotice(`${option.label}已恢復為系統內建預設音效；已開啟的終端需重新載入設定才會更新。`);
    } catch (resetError) {
      setSoundError(resetError.message ?? `${option.label}恢復預設失敗`);
    } finally {
      setSoundBusy("");
    }
  }

  async function handleSaveSettings(event) {
    event.preventDefault();
    setSettingsError("");
    setSettingsNotice("");
    if (!selectedBranch) {
      setSettingsError("請先選擇分店");
      return;
    }

    setSettingsBusy(true);
    try {
      const payload = await api.merchant.updateBranchSettings(selectedBranch, {
        name: settingsForm.name,
        address: settingsForm.address,
        phone: settingsForm.phone,
        timezone: settingsForm.timezone,
        dailyRedemptionLimit: Number(settingsForm.dailyRedemptionLimit),
        themeColor: settingsForm.themeColor,
        resetInterval: Number(settingsForm.resetInterval),
        reminderInterval: Number(settingsForm.reminderInterval),
        pointCollectionEffect: settingsForm.pointCollectionEffect,
        redemptionEffect: settingsForm.redemptionEffect,
        screensaverTimeout: Number(settingsForm.screensaverTimeout),
        enableConfetti: settingsForm.enableConfetti,
        enableSound: settingsForm.enableSound,
      });
      setBranches((current) => current.map((branch) => (
        branch.id === selectedBranch ? { ...branch, ...payload.branch } : branch
      )));
      setSettingsNotice("分店設定已儲存");
    } catch (settingsSaveError) {
      setSettingsError(settingsSaveError.message ?? "分店設定儲存失敗");
    } finally {
      setSettingsBusy(false);
    }
  }

  async function handleGenerateKey() {
    if (!selectedBranch) return;
    if (!window.confirm("重新產生後，舊金鑰會立即失效，且目前已連線的終端會被登出。要繼續嗎？")) return;
    setTerminalError("");
    setTerminalNotice("");
    setTerminalBusy(true);
    try {
      const payload = await api.merchant.createTerminalKey(selectedBranch);
      setGeneratedKey(payload.key);
      setCopied(false);
      setBranches((current) => current.map((branch) => (
        branch.id === selectedBranch
          ? { ...branch, terminal_key_hint: payload.keyHint, terminal_key_active: true, terminal_key_created_at: payload.createdAt ?? new Date().toISOString() }
          : branch
      )));
      setTerminalNotice("新金鑰已產生，請立即複製並保存");
    } catch (keyError) {
      setTerminalError(keyError.message ?? "終端金鑰產生失敗");
    } finally {
      setTerminalBusy(false);
    }
  }

  async function handleRevokeKey() {
    if (!selectedBranch) return;
    if (!window.confirm("撤銷後，此分店的終端金鑰與現有終端連線都會失效。要繼續嗎？")) return;
    setTerminalError("");
    setTerminalNotice("");
    setTerminalBusy(true);
    try {
      await api.merchant.revokeTerminalKey(selectedBranch);
      setGeneratedKey("");
      setCopied(false);
      setBranches((current) => current.map((branch) => (
        branch.id === selectedBranch ? { ...branch, terminal_key_active: false } : branch
      )));
      setTerminalNotice("終端金鑰已撤銷，現有終端連線已失效");
    } catch (keyError) {
      setTerminalError(keyError.message ?? "終端金鑰撤銷失敗");
    } finally {
      setTerminalBusy(false);
    }
  }

  async function handleCopyKey() {
    if (!generatedKey) return;
    try {
      await navigator.clipboard.writeText(generatedKey);
      setCopied(true);
      setTerminalNotice("金鑰已複製到剪貼簿");
    } catch {
      setTerminalError("無法自動複製，請手動選取並保存金鑰");
    }
  }

  async function handlePasswordChange(event) {
    event.preventDefault();
    setPasswordError("");
    setPasswordNotice("");
    if (newPassword !== confirmPassword) {
      setPasswordError("兩次輸入的新密碼不一致");
      return;
    }
    if (newPassword.length < 12) {
      setPasswordError("新密碼至少需要 12 個字元");
      return;
    }

    setPasswordBusy(true);
    try {
      await api.auth.changePassword(currentPassword, newPassword);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setPasswordNotice("密碼已更新，其他登入工作階段已安全登出");
    } catch (passwordChangeError) {
      setPasswordError(passwordChangeError.message ?? "密碼更新失敗");
    } finally {
      setPasswordBusy(false);
    }
  }

  if (loading) return <LoadingState label="載入設定…" />;

  return (
    <div className="page-stack settings-page">
      <div className="page-heading settings-page__heading">
        <span className="eyebrow">SYSTEM SETTINGS</span>
        <h1>系統設定 <span>Settings</span></h1>
        <p>管理您的帳號安全與分店終端機風格。</p>
      </div>
      <ErrorMessage message={error} />
      {notice && <div className="status-message status-message--success" role="status"><strong>完成</strong><span>{notice}</span></div>}

      <div className="settings-layout">
        <div className="settings-column">
          <section className="content-card settings-card settings-card--security">
            <SettingsSectionHeading icon={ShieldCheck} eyebrow="ACCOUNT SECURITY" title="帳號安全" description="更新後台登入密碼，保護商家資料與分店設定。" tone="indigo" />
            <form className="password-form settings-password-form" onSubmit={handlePasswordChange}>
              <label className="field-label" htmlFor="current-password">目前密碼
                <input id="current-password" type="password" autoComplete="current-password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} disabled={passwordBusy} required />
              </label>
              <label className="field-label" htmlFor="new-password">新的登入密碼
                <input id="new-password" type="password" autoComplete="new-password" minLength={12} value={newPassword} onChange={(event) => setNewPassword(event.target.value)} disabled={passwordBusy} required placeholder="至少 12 個字元" />
              </label>
              <label className="field-label" htmlFor="confirm-password">確認新密碼
                <input id="confirm-password" type="password" autoComplete="new-password" minLength={12} value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} disabled={passwordBusy} required />
              </label>
              {passwordError && <div className="inline-error" role="alert">{passwordError}</div>}
              {passwordNotice && <div className="inline-success" role="status">{passwordNotice}</div>}
              <button className="button button--dark settings-card__full-button" type="submit" disabled={passwordBusy}>{passwordBusy ? "更新中…" : "更新密碼 Update Password"}</button>
            </form>
          </section>

          <section className="content-card settings-card settings-card--terminal-security">
            <SettingsSectionHeading icon={KeyRound} eyebrow="TERMINAL ACCESS" title="終端安全" description={`新終端金鑰格式為 ${storeCode} + 4 位數字，只儲存雜湊值。`} tone="teal" />
            <div className="terminal-key-panel">
              <div className="terminal-key-panel__header"><div><span className="eyebrow">CURRENT BRANCH</span><strong>{activeBranch?.name ?? "尚未選擇分店"}</strong></div><span className={`status-pill ${activeBranch?.terminal_key_active ? "status-pill--active" : "status-pill--muted"}`}>{activeBranch?.terminal_key_active ? "金鑰啟用中" : activeBranch?.terminal_key_hint ? "金鑰已撤銷" : "尚未建立金鑰"}</span></div>
              <p className="terminal-key-meta">商家代碼：<code>{storeCode}</code> · 目前提示：{activeBranch?.terminal_key_hint ?? "尚未建立"}</p>
              {generatedKey && <div className="terminal-key-reveal" role="status"><strong>新金鑰（只顯示這一次）</strong><div className="terminal-key-value"><code>{generatedKey}</code><button className="button button--success" type="button" onClick={handleCopyKey}>{copied ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />}{copied ? "已複製" : "複製金鑰"}</button></div><p>請將金鑰保存於安全位置；離開此頁後無法再次查看完整內容。</p></div>}
              {terminalError && <div className="inline-error" role="alert">{terminalError}</div>}
              {terminalNotice && <div className="inline-success" role="status">{terminalNotice}</div>}
              <div className="settings-actions"><button className="button button--primary" type="button" onClick={handleGenerateKey} disabled={terminalBusy || !selectedBranch}><KeyRound size={17} aria-hidden="true" />{terminalBusy ? "處理中…" : activeBranch?.terminal_key_active ? "重新產生金鑰" : "產生終端金鑰"}</button><button className="button button--danger" type="button" onClick={handleRevokeKey} disabled={terminalBusy || !activeBranch?.terminal_key_active}><Ban size={17} aria-hidden="true" />撤銷目前金鑰</button></div>
            </div>
          </section>

          <section className="content-card settings-card settings-card--summary">
            <div className="content-card__header"><div><span className="eyebrow">BRANCH SETTINGS</span><h2>分店設定摘要</h2></div></div>
            {branches.length === 0 ? <p className="muted-copy">目前沒有可顯示的分店。</p> : <div className="settings-list">{branches.map((branch) => <div className="settings-list__row" key={branch.id}><strong>{branch.name}</strong><span>每日兌點上限：{branch.daily_redemption_limit ?? 2} 次</span><span>圖片：{branch.logo_asset_id || branch.screensaver_asset_id ? "已設定" : "尚未上傳"}</span></div>)}</div>}
          </section>
        </div>

        <div className="settings-column">
          <section className="content-card settings-card settings-card--customization">
            <SettingsSectionHeading icon={Palette} eyebrow="TERMINAL CUSTOMIZATION" title="終端機自訂" description="調整分店終端的圖片、主題與操作回饋。" tone="teal" />

            <label className="field-label settings-branch-picker" htmlFor="settings-branch">選擇分店
              <select id="settings-branch" value={selectedBranch} onChange={(event) => setSelectedBranch(event.target.value)} disabled={settingsBusy || uploading || soundBranchBusy}>
                {branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
              </select>
            </label>

            <div className="settings-subsection settings-subsection--asset">
              <div className="settings-subsection-heading">
                <span className="settings-subsection-heading__icon"><ImagePlus size={17} aria-hidden="true" /></span>
                <div><strong>圖片資產</strong><small>圖片會重新上傳至 V2 儲存，不沿用舊版 URL。</small></div>
              </div>
              <form className="settings-upload settings-upload--legacy" onSubmit={handleUpload}>
                <label className="field-label" htmlFor="media-kind">圖片用途
                  <select id="media-kind" value={kind} onChange={(event) => setKind(event.target.value)} disabled={uploading}>
                    <option value="logo">分店 Logo</option>
                    <option value="screensaver">待機畫面</option>
                  </select>
                </label>
                <label className="field-label settings-upload__file" htmlFor="media-file">選擇檔案
                  <input ref={fileInputRef} id="media-file" type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => setFile(event.target.files?.[0] ?? null)} disabled={uploading} />
                </label>
                <button className="button button--secondary upload-button" type="submit" disabled={uploading || !selectedBranch || !file}><UploadCloud size={17} aria-hidden="true" />{uploading ? "上傳中…" : "上傳並套用"}</button>
              </form>
              <div className="asset-preview-grid" aria-live="polite">
                <AssetPreview label="分店 Logo" variant="logo" assetId={logoAssetId} previewUrl={previewUrls.logo} loading={previewLoading} />
                <AssetPreview label="待機畫面" variant="screensaver" assetId={screensaverAssetId} previewUrl={previewUrls.screensaver} loading={previewLoading} />
              </div>
              {previewError && <div className="inline-error" role="alert">{previewError}</div>}
            </div>

            <form className="settings-form settings-form--legacy" onSubmit={handleSaveSettings}>
              <div className="settings-subsection">
                <div className="settings-subsection-heading">
                  <span className="settings-subsection-heading__icon settings-subsection-heading__icon--indigo"><Save size={17} aria-hidden="true" /></span>
                  <div><strong>分店資料</strong><small>這些資訊會顯示在商家後台與終端流程中。</small></div>
                </div>
                <div className="settings-form-grid">
                  <label className="field-label" htmlFor="branch-name">分店名稱
                    <input id="branch-name" value={settingsForm.name} onChange={(event) => updateSettingsField("name", event.target.value)} disabled={settingsBusy} required />
                  </label>
                  <label className="field-label" htmlFor="branch-phone">聯絡電話
                    <input id="branch-phone" value={settingsForm.phone} onChange={(event) => updateSettingsField("phone", event.target.value)} disabled={settingsBusy} />
                  </label>
                  <label className="field-label" htmlFor="branch-address">分店地址
                    <input id="branch-address" value={settingsForm.address} onChange={(event) => updateSettingsField("address", event.target.value)} disabled={settingsBusy} />
                  </label>
                  <label className="field-label" htmlFor="branch-timezone">時區
                    <select id="branch-timezone" value={settingsForm.timezone} onChange={(event) => updateSettingsField("timezone", event.target.value)} disabled={settingsBusy}>
                      <option value="Asia/Taipei">Asia/Taipei</option>
                      <option value="Asia/Tokyo">Asia/Tokyo</option>
                      <option value="UTC">UTC</option>
                    </select>
                  </label>
                  <label className="field-label" htmlFor="daily-redemption-limit">每日兌點上限
                    <input id="daily-redemption-limit" type="number" min="0" max="10" value={settingsForm.dailyRedemptionLimit} onChange={(event) => updateSettingsField("dailyRedemptionLimit", event.target.value)} disabled={settingsBusy} />
                  </label>
                </div>
              </div>

              <div className="settings-subsection settings-subsection--terminal-options">
                <div className="settings-subsection-heading">
                  <span className="settings-subsection-heading__icon"><Monitor size={17} aria-hidden="true" /></span>
                  <div><strong>終端機流程</strong><small>完成操作後，終端會依照這裡的設定返回或提醒。</small></div>
                </div>

                <div className="settings-choice-group">
                  <span className="settings-choice-group__label">主題顏色 <small>Theme Color</small></span>
                  <div className="theme-swatches" role="group" aria-label="主題顏色">
                    {standardThemeColors.map((value) => <button key={value} type="button" className={`theme-swatch theme-swatch--${value} ${settingsForm.themeColor === value ? "theme-swatch--selected" : ""}`} onClick={() => updateSettingsField("themeColor", value)} disabled={settingsBusy} aria-label={value}>{settingsForm.themeColor === value && <Check size={17} aria-hidden="true" />}</button>)}
                  </div>
                </div>

                <div className="settings-choice-grid">
                  <div className="settings-choice-group">
                    <span className="settings-choice-group__label"><Timer size={14} aria-hidden="true" />自動重置秒數 <small>Reset Interval</small></span>
                    <div className="settings-option-pills">
                      {valueOptions(resetIntervalOptions, Number(settingsForm.resetInterval)).map((value) => <button key={value} type="button" className={Number(settingsForm.resetInterval) === value ? "settings-option-pill settings-option-pill--selected" : "settings-option-pill"} onClick={() => updateSettingsField("resetInterval", String(value))} disabled={settingsBusy}>{value === 0 ? "關閉" : `${value}s`}</button>)}
                    </div>
                    <p className="settings-help">完成操作後自動返回顧客查詢頁。</p>
                  </div>
                  <div className="settings-choice-group">
                    <span className="settings-choice-group__label"><AlertCircle size={14} aria-hidden="true" />提醒行動秒數 <small>Reminder Interval</small></span>
                    <div className="settings-option-pills settings-option-pills--rose">
                      {valueOptions(reminderIntervalOptions, Number(settingsForm.reminderInterval)).map((value) => <button key={value} type="button" className={Number(settingsForm.reminderInterval) === value ? "settings-option-pill settings-option-pill--selected" : "settings-option-pill"} onClick={() => updateSettingsField("reminderInterval", String(value))} disabled={settingsBusy}>{value === 0 ? "關閉" : `${value}s`}</button>)}
                    </div>
                    <p className="settings-help">閒置時播放音效與畫面提醒。</p>
                  </div>
                </div>

                <div className="settings-screensaver-panel">
                  <div className="settings-subsection-heading">
                    <span className="settings-subsection-heading__icon"><Monitor size={17} aria-hidden="true" /></span>
                    <div><strong>自動螢幕保護程式</strong><small>當終端閒置時顯示待機畫面。</small></div>
                  </div>
                  <span className="settings-choice-group__label">啟動閒置秒數 <small>Screen Saver Timeout</small></span>
                  <div className="settings-option-pills">
                    {screensaverTimeoutOptions.map((value) => <button key={value} type="button" className={Number(settingsForm.screensaverTimeout) === value ? "settings-option-pill settings-option-pill--selected" : "settings-option-pill"} onClick={() => updateSettingsField("screensaverTimeout", String(value))} disabled={settingsBusy}>{value === 0 ? "關閉" : value === 60 ? "1 分鐘" : value === 120 ? "2 分鐘" : value === 300 ? "5 分鐘" : `${value}s`}</button>)}
                  </div>
                </div>
              </div>

              <div className="settings-subsection settings-subsection--effects">
                <div className="settings-subsection-heading">
                  <span className="settings-subsection-heading__icon settings-subsection-heading__icon--amber"><Sparkles size={17} aria-hidden="true" /></span>
                  <div><strong>特效設定 <small>Effects</small></strong><small>設定集點與兌換成功時的動畫和音效回饋。</small></div>
                </div>
                <div className="settings-toggle-list">
                  <label className="settings-toggle">
                    <span className="settings-toggle__copy"><span className="settings-toggle__icon settings-toggle__icon--teal"><Sparkles size={17} aria-hidden="true" /></span><span><strong>慶祝特效</strong><small>啟用集點與兌換動畫效果</small></span></span>
                    <input type="checkbox" checked={settingsForm.enableConfetti} onChange={(event) => updateSettingsField("enableConfetti", event.target.checked)} disabled={settingsBusy} />
                    <span className="settings-toggle__track" aria-hidden="true" />
                  </label>
                  <div className={`settings-effect-selectors ${settingsForm.enableConfetti ? "" : "settings-effect-selectors--disabled"}`}>
                    <label className="field-label" htmlFor="point-collection-effect">集點獲得點數時
                      <select id="point-collection-effect" value={settingsForm.pointCollectionEffect} onChange={(event) => updateSettingsField("pointCollectionEffect", event.target.value)} disabled={settingsBusy || !settingsForm.enableConfetti}>
                        {collectionEffects.map((value) => <option key={value} value={value}>{effectLabels[value]}</option>)}
                      </select>
                    </label>
                    <label className="field-label" htmlFor="redemption-effect">兌換成功時
                      <select id="redemption-effect" value={settingsForm.redemptionEffect} onChange={(event) => updateSettingsField("redemptionEffect", event.target.value)} disabled={settingsBusy || !settingsForm.enableConfetti}>
                        {redemptionEffects.map((value) => <option key={value} value={value}>{effectLabels[value]}</option>)}
                      </select>
                    </label>
                  </div>
                  <label className="settings-toggle">
                    <span className="settings-toggle__copy"><span className="settings-toggle__icon settings-toggle__icon--indigo"><Volume2 size={17} aria-hidden="true" /></span><span><strong>音效回饋</strong><small>操作成功時播放提示音</small></span></span>
                    <input type="checkbox" checked={settingsForm.enableSound} onChange={(event) => updateSettingsField("enableSound", event.target.checked)} disabled={settingsBusy} />
                    <span className="settings-toggle__track" aria-hidden="true" />
                  </label>
                  <div className="sound-settings-grid">
                    {soundOptions.map((option) => {
                      const assetId = activeBranch?.[option.assetField] ?? "";
                      const currentName = activeBranch?.[option.nameField];
                      const draftUrl = soundDraftUrls[option.key];
                      const previewUrl = soundPreviewUrls[option.key];
                      const selectedFile = soundFiles[option.key];
                      const isBusy = soundBusy === option.key;
                      const previewSource = draftUrl || previewUrl || `${import.meta.env.BASE_URL}${option.fallback}`;
                      const previewUnavailable = Boolean(assetId && !draftUrl && !previewUrl);
                      return (
                        <section className="sound-settings-card" key={option.key} aria-label={option.label}>
                          <div className="sound-settings-card__header">
                            <div><strong>{option.label}</strong><small>{currentName || (assetId ? "已上傳自訂音效" : "使用系統內建音效")}</small></div>
                            <span className={`status-pill ${assetId ? "status-pill--active" : "status-pill--muted"}`}>{assetId ? "自訂" : "預設"}</span>
                          </div>
                          {previewUnavailable
                            ? <p className="sound-settings-card__loading">{soundPreviewLoading ? "自訂音效載入中…" : soundPreviewError ? "預覽載入失敗，終端會使用內建預設音效。" : "正在準備自訂音效…"}</p>
                            : <audio className="sound-settings-card__player" controls preload="none" src={previewSource} aria-label={`試聽${option.label}`} />}
                          <label className="field-label" htmlFor={`sound-file-${option.key}`}>選擇 MP3（最大 1 MB）
                            <input
                              ref={(element) => { soundFileInputRefs.current[option.key] = element; }}
                              id={`sound-file-${option.key}`}
                              type="file"
                              accept=".mp3,audio/mpeg"
                              onChange={(event) => handleSoundFileChange(option.key, event.target.files?.[0] ?? null)}
                              disabled={soundBranchBusy || !selectedBranch}
                            />
                          </label>
                          {selectedFile && <span className="sound-settings-card__filename" title={selectedFile.name}>{selectedFile.name}</span>}
                          <div className="sound-settings-card__actions">
                            <button className="button button--secondary" type="button" onClick={() => handleSoundUpload(option.key)} disabled={soundBranchBusy || !selectedBranch || !selectedFile}>
                              <UploadCloud size={16} aria-hidden="true" />{isBusy ? "上傳中…" : "上傳並套用"}
                            </button>
                            {assetId && <button className="button button--danger" type="button" onClick={() => handleSoundReset(option.key)} disabled={soundBranchBusy}>
                              <Volume2 size={16} aria-hidden="true" />恢復預設
                            </button>}
                          </div>
                        </section>
                      );
                    })}
                  </div>
                  <p className="settings-help sound-settings-help">自訂音效只套用到目前分店；未設定時會使用原有的 coin.mp3 與 celebration.mp3。上傳成功後，已開啟的終端需重新載入設定才會更新。</p>
                  {soundPreviewError && <div className="inline-error" role="alert">{soundPreviewError}</div>}
                  {soundError && <div className="inline-error" role="alert">{soundError}</div>}
                  {soundNotice && <div className="inline-success" role="status">{soundNotice}</div>}
                </div>
              </div>

              {settingsError && <div className="inline-error" role="alert">{settingsError}</div>}
              {settingsNotice && <div className="inline-success" role="status">{settingsNotice}</div>}
              <div className="settings-actions settings-actions--save"><button className="button button--primary button--large settings-card__full-button" type="submit" disabled={settingsBusy || !selectedBranch}><Save size={17} aria-hidden="true" />{settingsBusy ? "儲存中…" : "儲存分店設定 Save Changes"}</button></div>
            </form>
          </section>
        </div>
      </div>
    </div>
  );
}
