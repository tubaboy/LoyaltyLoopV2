import { Link } from "react-router-dom";

export default function AuthLayout({ children, title = "商家控制台登入" }) {
  return (
    <main className="auth-page">
      <div className="auth-shell">
        <div className="auth-brand">
          <Link to="/" className="auth-brand-link" aria-label="回到 LoyaltyLoop 首頁"><span className="auth-logo"><img src="/logo.png" alt="LoyaltyLoop Logo" /></span></Link>
          <h1 className="auth-brand-name">LoyaltyLoop</h1>
          <p className="auth-subtitle">{title} / Sign in to dashboard</p>
        </div>
        <section className="auth-card">{children}</section>
      </div>
    </main>
  );
}
