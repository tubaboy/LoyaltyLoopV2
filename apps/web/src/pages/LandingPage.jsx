import { Monitor, Store } from "lucide-react";
import { useNavigate } from "react-router-dom";

export default function LandingPage() {
  const navigate = useNavigate();

  function openTerminal() {
    if (document.documentElement.requestFullscreen && !document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => undefined);
    }
    navigate("/terminal-login");
  }

  return (
    <main className="landing-page">
      <div className="ambient ambient--teal" aria-hidden="true" />
      <div className="ambient ambient--indigo" aria-hidden="true" />
      <section className="landing-hero">
        <div className="landing-logo"><img src="/logo.png" alt="LoyaltyLoop Logo" /></div>
        <h1>Loyalty<span>Loop</span></h1>
        <p>智慧會員集點系統 <span aria-hidden="true">•</span> 您的顧客忠誠度專家</p>
      </section>
      <section className="entry-grid" aria-label="選擇使用入口">
        <button type="button" className="entry-card entry-card--terminal" onClick={openTerminal}><span className="entry-icon"><Store size={32} aria-hidden="true" /></span><span className="entry-card__title">開啟門市集點終端</span><span className="entry-card__description">適用於現場櫃檯人員。需輸入分店專屬金鑰 (Key) 即可進入操作。</span><span className="entry-card__action">立刻開始 →</span></button>
        <button type="button" className="entry-card entry-card--merchant" onClick={() => navigate("/login")}><span className="entry-icon"><Monitor size={32} aria-hidden="true" /></span><span className="entry-card__title">開啟商家管理系統</span><span className="entry-card__description">適用於經營者與管理員。需使用 Email 與密碼登入後台查看報表。</span><span className="entry-card__action">管理後台 →</span></button>
      </section>
      <footer className="landing-footer">© 2026 LoyaltyLoop Inc.</footer>
    </main>
  );
}
