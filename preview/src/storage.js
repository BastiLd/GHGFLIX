const key = (k) => `ghgflix-preview:${globalThis.__GHG_DEVICE__}:${k}`;
export default {
  async getItem(k) { return localStorage.getItem(key(k)); },
  async setItem(k, v) { localStorage.setItem(key(k), v); },
  async removeItem(k) { localStorage.removeItem(key(k)); },
};
