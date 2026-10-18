import { useEffect, useRef, useState } from "react";

export default function PwaRuntimeNotices() {
  const [updateState, setUpdateState] = useState("idle");
  const registrationRef = useRef(null);
  const reloadForUpdateRef = useRef(false);

  useEffect(() => {
    if (!import.meta.env.PROD || !("serviceWorker" in navigator)) return undefined;

    let isMounted = true;
    let registration = null;

    function observeInstallingWorker(worker) {
      if (!worker) return;

      worker.addEventListener("statechange", () => {
        if (isMounted && worker.state === "installed" && navigator.serviceWorker.controller) {
          setUpdateState("available");
        }
      });
    }

    function handleUpdateFound() {
      observeInstallingWorker(registration?.installing);
    }

    function handleControllerChange() {
      if (reloadForUpdateRef.current) window.location.reload();
    }

    function checkForUpdate() {
      if (document.visibilityState === "visible" && navigator.onLine) {
        registration?.update().catch(() => undefined);
      }
    }

    navigator.serviceWorker.addEventListener("controllerchange", handleControllerChange);
    navigator.serviceWorker.register("/sw.js")
      .then((serviceWorkerRegistration) => {
        if (!isMounted) return;

        registration = serviceWorkerRegistration;
        registrationRef.current = serviceWorkerRegistration;
        registration.addEventListener("updatefound", handleUpdateFound);

        if (registration.waiting && navigator.serviceWorker.controller) {
          setUpdateState("available");
        }
        observeInstallingWorker(registration.installing);

        window.addEventListener("focus", checkForUpdate);
        document.addEventListener("visibilitychange", checkForUpdate);
      })
      .catch(() => undefined);

    return () => {
      isMounted = false;
      navigator.serviceWorker.removeEventListener("controllerchange", handleControllerChange);
      window.removeEventListener("focus", checkForUpdate);
      document.removeEventListener("visibilitychange", checkForUpdate);
      registration?.removeEventListener("updatefound", handleUpdateFound);
      registrationRef.current = null;
    };
  }, []);

  function applyUpdate() {
    const waitingWorker = registrationRef.current?.waiting;
    if (!waitingWorker) {
      setUpdateState("idle");
      return;
    }

    reloadForUpdateRef.current = true;
    setUpdateState("applying");
    waitingWorker.postMessage({ type: "APPLY_UPDATE" });
  }

  if (updateState === "idle" || updateState === "dismissed") return null;

  return (
    <aside className="pwa-update-notice" role="status" aria-live="polite">
      <div className="pwa-update-notice__copy">
        <strong>{updateState === "applying" ? "正在更新" : "新版已準備完成"}</strong>
        <span>
          {updateState === "applying"
            ? "正在重新載入，請稍候。"
            : "請完成目前操作後再更新；更新時頁面會重新載入。"}
        </span>
      </div>
      {updateState === "available" && (
        <div className="pwa-update-notice__actions">
          <button type="button" className="pwa-update-notice__later" onClick={() => setUpdateState("dismissed")}>
            稍後
          </button>
          <button type="button" className="pwa-update-notice__apply" onClick={applyUpdate}>
            更新
          </button>
        </div>
      )}
    </aside>
  );
}
