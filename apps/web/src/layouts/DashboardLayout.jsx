import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { FileText, Gift, LayoutDashboard, LogOut, Menu, Settings, Store, UserRound, Users, X } from "lucide-react";
import { Brand } from "../components/Brand.jsx";
import { useAuth } from "../context/AuthContext.jsx";

const merchantLinks = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard, end: true },
  { to: "/dashboard/branches", label: "分店管理", icon: Store },
  { to: "/dashboard/members", label: "會員管理", icon: UserRound },
  { to: "/dashboard/transactions", label: "交易明細", icon: FileText },
  { to: "/dashboard/rewards", label: "兌換項目", icon: Gift },
  { to: "/dashboard/settings", label: "設定", icon: Settings },
];

const adminLinks = [{ to: "/admin", label: "商家列表", icon: Users, end: true }];

export default function DashboardLayout({ role = "merchant" }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { account, logout } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);
  const links = role === "admin" ? adminLinks : merchantLinks;

  useEffect(() => { setMobileOpen(false); }, [location.pathname]);

  async function handleLogout() {
    await logout();
    navigate("/login", { replace: true });
  }

  return (
    <div className="dashboard-shell">
      <aside className={`dashboard-sidebar ${mobileOpen ? "dashboard-sidebar--open" : ""}`}>
        <div className="sidebar-header">
          <div className="sidebar-brand-mark">
            <img src="/logo.png" alt="LoyaltyLoop Logo" />
          </div>
          <h1 className="sidebar-brand-name">Loyalty<span>Loop</span></h1>
          <span className="role-pill">{role === "admin" ? "SUPER ADMIN" : "MERCHANT CONSOLE"}</span>
          <div className="account-chip"><span className="avatar">{account?.email?.[0]?.toUpperCase() ?? "?"}</span><span className="account-chip__text"><small>目前帳號</small><strong title={account?.email}>{account?.email ?? "未命名帳號"}</strong></span></div>
        </div>
        <nav className="sidebar-nav" aria-label="後台導覽">
          {links.map(({ to, label, icon: Icon, end }) => <NavLink key={to} to={to} end={end} className={({ isActive }) => `sidebar-link ${isActive ? "sidebar-link--active" : ""}`}><Icon size={19} strokeWidth={2.2} aria-hidden="true" /><span>{label}</span></NavLink>)}
        </nav>
        <div className="sidebar-footer"><button type="button" className="sidebar-logout" onClick={handleLogout}><LogOut size={19} aria-hidden="true" /><span>安全登出</span></button><small>LoyaltyLoopV2 · local</small></div>
      </aside>
      {mobileOpen && <button type="button" className="sidebar-backdrop" aria-label="關閉導覽" onClick={() => setMobileOpen(false)} />}
      <main className="dashboard-main">
        <header className="mobile-header"><button type="button" className="icon-button" aria-label={mobileOpen ? "關閉選單" : "開啟選單"} onClick={() => setMobileOpen((open) => !open)}>{mobileOpen ? <X size={22} /> : <Menu size={22} />}</button><Brand compact /><span className="mobile-header__spacer" /></header>
        <div className="dashboard-content"><Outlet /></div>
      </main>
    </div>
  );
}
