import { useEffect, useState } from "react";
import { BrowserRouter, Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { AuthProvider, useAuth } from "./context/AuthContext.jsx";
import { LoadingState } from "./components/Brand.jsx";
import AuthLayout from "./layouts/AuthLayout.jsx";
import DashboardLayout from "./layouts/DashboardLayout.jsx";
import LandingPage from "./pages/LandingPage.jsx";
import MerchantLogin from "./pages/MerchantLogin.jsx";
import TerminalLogin from "./pages/TerminalLogin.jsx";
import CustomerTerminal from "./pages/CustomerTerminal.jsx";
import AdminDashboard from "./pages/AdminDashboard.jsx";
import MerchantDashboard from "./pages/merchant/MerchantDashboard.jsx";
import BranchManagement from "./pages/merchant/BranchManagement.jsx";
import CustomerManagement from "./pages/merchant/CustomerManagement.jsx";
import RewardsManagement from "./pages/merchant/RewardsManagement.jsx";
import TransactionHistory from "./pages/merchant/TransactionHistory.jsx";
import Settings from "./pages/merchant/Settings.jsx";
import { api, ApiError } from "./lib/api.js";
import { NetworkStatusProvider } from "./context/NetworkStatusContext.jsx";
import PwaRuntimeNotices from "./components/PwaRuntimeNotices.jsx";

function ProtectedRoute({ children, allowedRole }) {
  const location = useLocation();
  const { account, loading } = useAuth();
  if (loading) return <LoadingState label="同步帳號資料…" />;
  if (!account) return <Navigate to="/login" replace state={{ from: location }} />;
  if (allowedRole && account.role !== allowedRole) return <Navigate to={account.role === "admin" ? "/admin" : "/dashboard"} replace />;
  return children;
}

function TerminalRoute() {
  const navigate = useNavigate();
  const [terminal, setTerminal] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    api.terminal.context()
      .then((payload) => { if (mounted) setTerminal(payload.terminal); })
      .catch((error) => { if (error instanceof ApiError && error.status === 401) navigate("/terminal-login", { replace: true }); })
      .finally(() => { if (mounted) setLoading(false); });
    return () => { mounted = false; };
  }, [navigate]);

  if (loading) return <LoadingState label="載入分店終端…" />;
  if (!terminal) return null;
  return <CustomerTerminal terminal={terminal} />;
}

function AppRoutes() {
  return <Routes>
    <Route path="/" element={<LandingPage />} />
    <Route path="/login" element={<AuthLayout><MerchantLogin /></AuthLayout>} />
    <Route path="/terminal-login" element={<TerminalLogin />} />
    <Route path="/terminal" element={<TerminalRoute />} />
    <Route path="/dashboard" element={<ProtectedRoute allowedRole="merchant"><DashboardLayout /></ProtectedRoute>}>
      <Route index element={<MerchantDashboard />} />
      <Route path="branches" element={<BranchManagement />} />
      <Route path="members" element={<CustomerManagement />} />
      <Route path="transactions" element={<TransactionHistory />} />
      <Route path="rewards" element={<RewardsManagement />} />
      <Route path="settings" element={<Settings />} />
    </Route>
    <Route path="/admin" element={<ProtectedRoute allowedRole="admin"><DashboardLayout role="admin" /></ProtectedRoute>}><Route index element={<AdminDashboard />} /></Route>
    <Route path="*" element={<Navigate to="/" replace />} />
  </Routes>;
}

export default function App() {
  return (
    <BrowserRouter>
      <NetworkStatusProvider>
        <PwaRuntimeNotices />
        <AuthProvider><AppRoutes /></AuthProvider>
      </NetworkStatusProvider>
    </BrowserRouter>
  );
}
