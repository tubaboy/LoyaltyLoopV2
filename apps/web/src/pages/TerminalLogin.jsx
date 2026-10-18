import { useState } from "react";
import { ArrowLeft, LoaderCircle, Maximize, Monitor } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { Brand, ErrorMessage } from "../components/Brand.jsx";
import { api } from "../lib/api.js";
import { useNetworkStatus } from "../context/NetworkStatusContext.jsx";

function isValidTerminalKey(value) {
  return /^(?:[A-Z0-9]{8}|[A-Z0-9]{12})$/.test(value);
}

export default function TerminalLogin() {
  const navigate = useNavigate();
  const isOnline = useNetworkStatus();
  const [key, setKey] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  function toggleFullscreen() {
    if (document.documentElement.requestFullscreen && !document.fullscreenElement) document.documentElement.requestFullscreen().catch(() => undefined);
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (!isOnline) {
      setError("目前沒有網路連線，請恢復連線後再登入。");
      return;
    }
    if (!isValidTerminalKey(key)) {
      setError("請輸入完整的 8 碼登入金鑰（商家代碼 + 4 位數字）");
      return;
    }
    setError("");
    setLoading(true);
    try {
      await api.terminal.login(key);
      navigate("/terminal", { replace: true });
    } catch (loginError) {
      setError(loginError.message ?? "找不到此金鑰對應的分店");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="terminal-login-page">
      <Link to="/" className="back-link"><ArrowLeft size={18} aria-hidden="true" />返回首頁</Link>
      <section className="terminal-login-card">
        <div className="terminal-login-card__header"><Brand compact /><span className="terminal-icon"><Monitor size={28} aria-hidden="true" /></span><h1>分店終端登入</h1><p>請輸入商家代碼加上 4 位數字的 8 碼登入金鑰。</p></div>
        <button type="button" className="fullscreen-button" onClick={toggleFullscreen}><Maximize size={17} aria-hidden="true" />建議使用全螢幕模式</button>
        <form className="form-stack" onSubmit={handleSubmit}>
          <label className="sr-only" htmlFor="terminal-key">分店登入金鑰</label>
          <input id="terminal-key" className="terminal-key-input" type="text" inputMode="text" autoCapitalize="characters" autoComplete="off" spellCheck="false" autoFocus value={key} onChange={(event) => setKey(event.target.value.replace(/[^A-Za-z0-9]/g, "").toUpperCase().slice(0, 12))} placeholder="5TZT1234" maxLength={12} />
          <ErrorMessage message={error} />
          <button type="submit" className="button button--primary button--large" disabled={!isOnline || loading || !isValidTerminalKey(key)}>{loading ? <LoaderCircle className="spin" size={20} aria-hidden="true" /> : "進入集點系統"}</button>
        </form>
      </section>
    </main>
  );
}
