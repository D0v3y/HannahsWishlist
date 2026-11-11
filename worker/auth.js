// Checks the Firebase sign-in token the site sends along (Authorization: Bearer …).
// Only people signed in to the wishlist (guest password or own account) get through.

const GOOGLE_KEYS = "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com";
let keyCache = { keys: new Map(), expires: 0, fetched: 0 };

// Returns { uid, email, token } for a valid token, otherwise null.
export async function verifyUser(request, env) {
  const header = request.headers.get("Authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  const parts = token.split(".");
  if (parts.length !== 3) return null;

  let head, claims;
  try {
    head = JSON.parse(base64UrlText(parts[0]));
    claims = JSON.parse(base64UrlText(parts[1]));
  } catch {
    return null;
  }
  if (head.alg !== "RS256" || !head.kid) return null;

  const key = await publicKey(head.kid, env);
  if (!key) return null;
  const signed = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
  if (!(await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, base64UrlBytes(parts[2]), signed))) return null;

  const now = Math.floor(Date.now() / 1000);
  const project = env.FIREBASE_PROJECT_ID;
  if (claims.aud !== project || claims.iss !== `https://securetoken.google.com/${project}`) return null;
  if (!(claims.exp > now) || claims.iat > now + 300 || !claims.sub) return null;
  return { uid: claims.sub, email: String(claims.email || "").toLowerCase(), token };
}

async function publicKey(kid, env) {
  const now = Date.now();
  const stale = now > keyCache.expires || (!keyCache.keys.has(kid) && now - keyCache.fetched > 60_000);
  if (stale) {
    const res = await fetch(env.FIREBASE_KEYS_URL || GOOGLE_KEYS); // overridable only for local tests
    if (res.ok) {
      const { keys } = await res.json();
      const map = new Map();
      for (const jwk of keys) {
        map.set(jwk.kid, await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]));
      }
      const maxAge = Number(/max-age=(\d+)/.exec(res.headers.get("Cache-Control") || "")?.[1] || 3600);
      keyCache = { keys: map, expires: now + maxAge * 1000, fetched: now };
    }
  }
  return keyCache.keys.get(kid) || null;
}

function base64UrlBytes(text) {
  const b64 = text.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(text.length / 4) * 4, "=");
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

function base64UrlText(text) {
  return new TextDecoder().decode(base64UrlBytes(text));
}
