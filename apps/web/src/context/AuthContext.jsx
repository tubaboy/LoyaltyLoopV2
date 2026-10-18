import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { api, ApiError } from "../lib/api.js";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [account, setAccount] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    api.auth.me()
      .then((payload) => {
        if (mounted) setAccount(payload.account);
      })
      .catch((error) => {
        if (mounted && (!(error instanceof ApiError) || error.status !== 401)) {
          console.error("Failed to restore account session", error);
        }
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });

    return () => { mounted = false; };
  }, []);

  const value = useMemo(() => ({
    account,
    loading,
    async login(email, password) {
      const payload = await api.auth.login(email, password);
      setAccount(payload.account);
      return payload.account;
    },
    async logout() {
      await api.auth.logout();
      setAccount(null);
    },
  }), [account, loading]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used inside AuthProvider");
  return context;
}
