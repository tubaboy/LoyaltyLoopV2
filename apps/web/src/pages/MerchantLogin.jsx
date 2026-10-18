import { useState } from "react";
import { LoaderCircle } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { ErrorMessage } from "../components/Brand.jsx";
import { useAuth } from "../context/AuthContext.jsx";

export default function MerchantLogin() {
  const navigate = useNavigate();
  const location = useLocation();
  const { login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");
    setLoading(true);
    try {
      const account = await login(email, password);
      const target = location.state?.from?.pathname ?? (account.role === "admin" ? "/admin" : "/dashboard");
      navigate(target, { replace: true });
    } catch (loginError) {
      setError(loginError.message ?? "登入失敗，請檢查帳號密碼");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form className="form-stack auth-login-form" onSubmit={handleSubmit}>
      <label className="field-label" htmlFor="email">電子郵件信箱<input id="email" name="email" type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="name@business.com" required /></label>
      <label className="field-label" htmlFor="password">登入密碼<input id="password" name="password" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="輸入密碼" required /></label>
      <ErrorMessage message={error} />
      <button type="submit" className="button button--primary button--large" disabled={loading}>{loading ? <LoaderCircle className="spin" size={20} aria-hidden="true" /> : "登入系統"}</button>
      <p className="form-help">商家帳號由管理員開立，若有疑問請聯絡系統管理員。</p>
    </form>
  );
}
