export function Brand({ compact = false, light = false }) {
  return (
    <div className={`brand ${compact ? "brand--compact" : ""} ${light ? "brand--light" : ""}`}>
      <div className="brand-mark"><img src="/logo.png" alt="" /></div>
      <div>
        <strong className="brand-name">Loyalty<span>Loop</span></strong>
        {!compact && <small>智慧會員集點系統</small>}
      </div>
    </div>
  );
}

export function ErrorMessage({ message }) {
  if (!message) return null;
  return <div className="status-message status-message--error" role="alert"><strong>系統提示</strong><span>{message}</span></div>;
}

export function LoadingState({ label = "載入中…" }) {
  return <div className="loading-state" role="status" aria-live="polite"><span className="spinner" aria-hidden="true" /><span>{label}</span></div>;
}
