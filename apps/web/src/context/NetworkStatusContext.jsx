import { createContext, useContext, useEffect, useState } from "react";

const NetworkStatusContext = createContext(true);

export function NetworkStatusProvider({ children }) {
  const [isOnline, setIsOnline] = useState(() => (
    typeof navigator === "undefined" || navigator.onLine
  ));

  useEffect(() => {
    const updateNetworkStatus = () => setIsOnline(navigator.onLine);
    window.addEventListener("online", updateNetworkStatus);
    window.addEventListener("offline", updateNetworkStatus);

    return () => {
      window.removeEventListener("online", updateNetworkStatus);
      window.removeEventListener("offline", updateNetworkStatus);
    };
  }, []);

  return (
    <NetworkStatusContext.Provider value={isOnline}>
      {!isOnline && (
        <div className="pwa-offline-notice" role="status" aria-live="polite">
          <strong>目前離線</strong>
          <span>登入、會員查詢與點數操作都需要網路連線。</span>
        </div>
      )}
      {children}
    </NetworkStatusContext.Provider>
  );
}

export function useNetworkStatus() {
  return useContext(NetworkStatusContext);
}
