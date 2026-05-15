/** Metered.ca ICE — https://www.metered.ca/docs/turn-server-service/creating-turn-credentials */

const FALLBACK_ICE = [{ urls: "stun:stun.l.google.com:19302" }];

function meteredStaticServers(username, credential) {
  const auth = { username, credential };
  return [
    { urls: "stun:stun.relay.metered.ca:80" },
    { urls: "turn:global.relay.metered.ca:80", ...auth },
    { urls: "turn:global.relay.metered.ca:80?transport=tcp", ...auth },
    { urls: "turn:global.relay.metered.ca:443", ...auth },
    { urls: "turns:global.relay.metered.ca:443?transport=tcp", ...auth },
  ];
}

async function fetchMeteredUrl(url) {
  const res = await fetch(url);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `TURN credentials failed (${res.status})`);
  }
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error("TURN credentials empty");
  }
  return data;
}

let cache = null;
let cacheExpiry = 0;
const CACHE_MS = 50 * 60 * 1000;

function hasTurn(servers) {
  return servers.some((s) => {
    const urls = Array.isArray(s.urls) ? s.urls : [s.urls];
    return urls.some((u) => /^(turn|turns):/i.test(String(u)));
  });
}

async function fetchFromProxy() {
  const bases = [""];
  if (import.meta.env.DEV) {
    bases.push("http://localhost:3001");
  }
  const serverUrl = import.meta.env.VITE_SERVER_URL;
  if (serverUrl && !bases.includes(serverUrl)) {
    bases.push(serverUrl.replace(/\/$/, ""));
  }

  for (const base of bases) {
    try {
      const res = await fetch(`${base}/api/turn-credentials`);
      if (!res.ok) continue;
      const servers = await res.json();
      if (Array.isArray(servers) && servers.length) return servers;
    } catch {
      /* thử URL tiếp theo */
    }
  }
  return null;
}

/**
 * Thứ tự ưu tiên:
 * 1. GET /api/turn-credentials (server giữ METERED_API_KEY)
 * 2. VITE_METERED_API_KEY + VITE_METERED_APP_NAME (dev / build client)
 * 3. VITE_METERED_TURN_USERNAME + VITE_METERED_TURN_CREDENTIAL (credential cố định từ dashboard)
 * 4. Chỉ STUN Google
 */
export async function resolveIceServers() {
  const now = Date.now();
  if (cache && now < cacheExpiry) return cache;

  const proxied = await fetchFromProxy();
  if (proxied) {
    cache = proxied;
    cacheExpiry = now + CACHE_MS;
    return proxied;
  }

  const apiKey = import.meta.env.VITE_METERED_API_KEY;
  const appName = import.meta.env.VITE_METERED_APP_NAME;
  if (apiKey && appName) {
    try {
      const url = new URL(
        `https://${appName}.metered.live/api/v1/turn/credentials`
      );
      url.searchParams.set("apiKey", apiKey);
      const region = import.meta.env.VITE_METERED_REGION;
      if (region) url.searchParams.set("region", region);
      cache = await fetchMeteredUrl(url);
      cacheExpiry = now + CACHE_MS;
      return cache;
    } catch {
      /* thử phương án username/password hoặc STUN */
    }
  }

  const username = import.meta.env.VITE_METERED_TURN_USERNAME;
  const credential = import.meta.env.VITE_METERED_TURN_CREDENTIAL;
  if (username && credential) {
    cache = meteredStaticServers(username, credential);
    cacheExpiry = now + CACHE_MS;
    return cache;
  }

  return FALLBACK_ICE;
}

export function iceServersUseTurn(servers) {
  return hasTurn(servers);
}

export function resetIceServersCache() {
  cache = null;
  cacheExpiry = 0;
}
