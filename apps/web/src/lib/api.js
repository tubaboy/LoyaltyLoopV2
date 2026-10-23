const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3000";

export class ApiError extends Error {
  constructor(message, status, code) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

async function request(path, options = {}) {
  const headers = new Headers(options.headers);
  if (options.body !== undefined && !(options.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...options,
    headers,
    credentials: "include",
  });

  const payload = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) {
    throw new ApiError(
      payload?.error ?? "系統發生錯誤，請稍後再試",
      response.status,
      payload?.code,
    );
  }

  return payload;
}

async function requestBlob(path, options = {}) {
  const headers = new Headers(options.headers);
  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...options,
    headers,
    credentials: "include",
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new ApiError(
      payload?.error ?? "圖片載入失敗，請稍後再試",
      response.status,
      payload?.code,
    );
  }

  return response.blob();
}

const json = (value) => JSON.stringify(value);

export const api = {
  auth: {
    me: () => request("/api/v2/auth/me"),
    login: (email, password) => request("/api/v2/auth/login", { method: "POST", body: json({ email, password }) }),
    changePassword: (currentPassword, newPassword) => request("/api/v2/auth/password", { method: "POST", body: json({ currentPassword, newPassword }) }),
    logout: () => request("/api/v2/auth/logout", { method: "POST" }),
  },
  terminal: {
    login: (key) => request("/api/v2/terminal/login", { method: "POST", body: json({ key }) }),
    context: () => request("/api/v2/terminal/context"),
    logout: () => request("/api/v2/terminal/logout", { method: "POST" }),
    customer: (phone) => request(`/api/v2/terminal/customer?phone=${encodeURIComponent(phone)}`),
    options: () => request("/api/v2/terminal/options"),
    redemptionCount: (phone) => request(`/api/v2/terminal/redemption-count?phone=${encodeURIComponent(phone)}`),
    addPoints: (payload) => request("/api/v2/terminal/points/add", { method: "POST", body: json(payload) }),
    redeemPoints: (payload) => request("/api/v2/terminal/points/redeem", { method: "POST", body: json(payload) }),
  },
  media: {
    download: (assetId) => requestBlob(`/api/v2/media/${encodeURIComponent(assetId)}`),
  },
  merchant: {
    overview: () => request("/api/v2/merchant/overview"),
    dashboard: (params = {}) => {
      const query = new URLSearchParams();
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== "") query.set(key, String(value));
      });
      const queryString = query.toString();
      return request(`/api/v2/merchant/dashboard${queryString ? `?${queryString}` : ""}`);
    },
    branches: () => request("/api/v2/merchant/branches"),
    createBranch: (payload) => request("/api/v2/merchant/branches", { method: "POST", body: json(payload) }),
    updateBranch: (branchId, payload) => request(`/api/v2/merchant/branches/${encodeURIComponent(branchId)}`, { method: "PATCH", body: json(payload) }),
    deleteBranch: (branchId) => request(`/api/v2/merchant/branches/${encodeURIComponent(branchId)}`, { method: "DELETE" }),
    updateBranchSettings: (branchId, payload) => request(`/api/v2/merchant/branches/${encodeURIComponent(branchId)}/settings`, { method: "PATCH", body: json(payload) }),
    createTerminalKey: (branchId) => request(`/api/v2/merchant/branches/${encodeURIComponent(branchId)}/terminal-key`, { method: "POST" }),
    revokeTerminalKey: (branchId) => request(`/api/v2/merchant/branches/${encodeURIComponent(branchId)}/terminal-key/revoke`, { method: "POST" }),
    uploadMedia: (branchId, kind, file) => {
      const formData = new FormData();
      formData.set("branchId", branchId);
      formData.set("kind", kind);
      formData.set("file", file);
      return request("/api/v2/merchant/media", { method: "POST", body: formData });
    },
    uploadSound: (branchId, kind, file) => {
      const formData = new FormData();
      formData.set("branchId", branchId);
      formData.set("kind", kind);
      formData.set("file", file);
      return request("/api/v2/merchant/media/sounds", { method: "POST", body: formData });
    },
    resetSound: (branchId, kind) => request("/api/v2/merchant/media/sounds/reset", {
      method: "POST",
      body: json({ branchId, kind }),
    }),
    loyaltyOptions: (branchId) => request(`/api/v2/merchant/loyalty-options?branchId=${encodeURIComponent(branchId)}`),
    createLoyaltyOption: (payload) => request("/api/v2/merchant/loyalty-options", { method: "POST", body: json(payload) }),
    updateLoyaltyOption: (optionId, payload) => request(`/api/v2/merchant/loyalty-options/${encodeURIComponent(optionId)}`, { method: "PATCH", body: json(payload) }),
    deleteLoyaltyOption: (optionId) => request(`/api/v2/merchant/loyalty-options/${encodeURIComponent(optionId)}`, { method: "DELETE" }),
    customers: (params = {}) => {
      const query = new URLSearchParams();
      Object.entries({ limit: 20, offset: 0, ...params }).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== "") query.set(key, String(value));
      });
      return request(`/api/v2/merchant/customers?${query.toString()}`);
    },
    customer: (customerId, params = {}) => {
      const query = new URLSearchParams();
      Object.entries({ limit: 20, offset: 0, ...params }).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== "") query.set(key, String(value));
      });
      return request(`/api/v2/merchant/customers/${encodeURIComponent(customerId)}?${query.toString()}`);
    },
    transactions: (params = {}) => {
      const query = new URLSearchParams();
      Object.entries({ limit: 20, offset: 0, ...params }).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== "") query.set(key, String(value));
      });
      return request(`/api/v2/merchant/transactions?${query.toString()}`);
    },
  },
  admin: {
    merchants: (params = {}) => {
      const query = new URLSearchParams();
      Object.entries({ limit: 20, offset: 0, ...params }).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== "") query.set(key, String(value));
      });
      return request(`/api/v2/admin/merchants?${query.toString()}`);
    },
    createMerchant: (payload) => request("/api/v2/admin/merchants", { method: "POST", body: json(payload) }),
    updateMerchant: (merchantId, payload) => request(`/api/v2/admin/merchants/${encodeURIComponent(merchantId)}`, { method: "PATCH", body: json(payload) }),
    resetMerchantPassword: (merchantId, password) => request(`/api/v2/admin/merchants/${encodeURIComponent(merchantId)}/reset-password`, { method: "POST", body: json({ password }) }),
  },
};
