// app-devkit worker/claims.js 1.4.0. The `/api/claims` route and admin calls for the rules kit, for a Cloudflare Worker
// (Web Crypto and fetch, no dependencies).
//
// For people with a Firebase account (Google, email link, password): the page sends its ID token; the Worker verifies it
// (Google's public keys), asks the app's loadClaims for the role (the app reads its own role docs), writes the claims
// on the account (Identity Toolkit accounts:update) and deletes revoked/{uid}; the page then calls getIdToken(true).
// For link or passcode sign-ins use worker/custom-token.js instead: claims from a custom token win over claims written
// here, so this route refuses those sign-ins.
//
// The admin calls need a service account allowed to manage Firebase Auth users and write Firestore, scoped to one
// project. Its email and PEM key live in Worker secrets, never in a repo.

import { claimsShape, signJwt, serviceKey } from './custom-token.js';

const GOOGLE_KEYS = 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';
const OAUTH = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/cloud-platform';
const SKEW = 60; // seconds of clock difference allowed on iat and auth_time
const PROVIDERS = { 'google.com': 'google', password: 'password', emailLink: 'email', anonymous: 'anon' };

const dec = new TextDecoder();
const unb64 = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
const part = (s) => JSON.parse(dec.decode(unb64(s)));
const isDemo = (project) => /^demo-/.test(String(project || ''));

// Google's signing keys for ID tokens, kept until their max-age runs out.
let keyCache = null;
export const clearKeyCache = () => { keyCache = null; };
export async function googleKeys(now = Date.now()) {
  if (keyCache && now < keyCache.until) return keyCache.keys;
  const r = await fetch(GOOGLE_KEYS);
  if (!r.ok) throw new Error(`public keys ${r.status}`);
  const age = Number((r.headers.get('cache-control') || '').match(/max-age=(\d+)/)?.[1] || 3600);
  const keys = {};
  for (const k of (await r.json()).keys || []) {
    keys[k.kid] = await crypto.subtle.importKey('jwk', { kty: k.kty, n: k.n, e: k.e, alg: 'RS256', ext: true },
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  }
  keyCache = { keys, until: now + age * 1000 };
  return keys;
}

// Checks a Firebase ID token the way Firebase's docs list: RS256 by a current Google key, not expired, issued for this
// project. Returns its payload; throws (message says why) otherwise. keys: () => { kid: CryptoKey } (tests pass their own).
// emulator: true accepts the Auth emulator's unsigned tokens, only for a demo- project (never a real one).
export async function verifyIdToken(idToken, { project, now = Math.floor(Date.now() / 1000), keys = googleKeys, emulator = false } = {}) {
  if (!project) throw new Error('project missing');
  if (emulator && !isDemo(project)) throw new Error('emulator mode needs a demo- project');
  const bits = String(idToken || '').split('.');
  if (bits.length !== 3) throw new Error('not a JWT');
  let head, body;
  try { head = part(bits[0]); body = part(bits[1]); } catch { throw new Error('not a JWT'); }
  if (emulator && head.alg === 'none') {
    // the Auth emulator does not sign
  } else {
    if (head.alg !== 'RS256') throw new Error(`alg ${head.alg}`);
    const key = (await keys())[head.kid];
    if (!key) throw new Error('unknown key');
    const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, unb64(bits[2]), new TextEncoder().encode(`${bits[0]}.${bits[1]}`));
    if (!ok) throw new Error('bad signature');
  }
  if (body.aud !== project) throw new Error('wrong audience');
  if (body.iss !== `https://securetoken.google.com/${project}`) throw new Error('wrong issuer');
  if (typeof body.sub !== 'string' || !body.sub || body.sub.length > 128) throw new Error('no subject');
  if (!(body.exp > now)) throw new Error('expired');
  if (!(body.iat <= now + SKEW)) throw new Error('issued in the future');
  if (!(body.auth_time <= now + SKEW)) throw new Error('signed in in the future');
  return body;
}

// Firestore REST values <-> plain values (strings, numbers, booleans, null, Dates, arrays, maps).
export function toValue(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (typeof v === 'string') return { stringValue: v };
  if (v instanceof Date) return { timestampValue: v.toISOString() };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(toValue) } };
  return { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, toValue(x)])) } };
}
export function fromValue(v) {
  if ('nullValue' in v) return null;
  if ('booleanValue' in v) return v.booleanValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('stringValue' in v) return v.stringValue;
  if ('timestampValue' in v) return new Date(v.timestampValue);
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(fromValue);
  if ('mapValue' in v) return Object.fromEntries(Object.entries(v.mapValue.fields || {}).map(([k, x]) => [k, fromValue(x)]));
  return v; // references, geo points, bytes: left as Firestore sent them
}

// Admin calls for one project. config: { project, sa: { email, key } } and, for tests, emulator: { auth, firestore }
// ('host:port'; a demo- project only; no service account needed then).
export function admin({ project, sa, emulator } = {}) {
  if (!project) throw new Error('project missing');
  if (emulator && !isDemo(project)) throw new Error('emulator mode needs a demo- project');
  if (!emulator && (!sa?.email || !sa?.key)) throw new Error('service account email and key are needed');
  const authBase = emulator ? `http://${emulator.auth}/identitytoolkit.googleapis.com` : 'https://identitytoolkit.googleapis.com';
  const fsBase = emulator ? `http://${emulator.firestore}` : 'https://firestore.googleapis.com';
  const docs = `${fsBase}/v1/projects/${encodeURIComponent(project)}/databases/(default)/documents`;
  let cached = null;
  let key = null;

  async function accessToken(now = Math.floor(Date.now() / 1000)) {
    if (emulator) return 'owner'; // the emulators' admin token
    if (cached && now < cached.until) return cached.token;
    key ??= await serviceKey(sa.key);
    const assertion = await signJwt(key, { iss: sa.email, sub: sa.email, aud: OAUTH, scope: SCOPE, iat: now, exp: now + 3600 });
    const r = await fetch(OAUTH, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `grant_type=${encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer')}&assertion=${assertion}` });
    if (!r.ok) throw new Error(`access token ${r.status}`);
    const j = await r.json();
    cached = { token: j.access_token, until: now + Math.min(Number(j.expires_in) || 3600, 3600) - 300 };
    return cached.token;
  }
  async function call(method, url, body) {
    const r = await fetch(url, { method, headers: { Authorization: `Bearer ${await accessToken()}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body) });
    if (method === 'GET' && r.status === 404) return null;
    if (!r.ok) throw new Error(`${method} ${url.split('?')[0].split('/').slice(-2).join('/')} ${r.status}`);
    return r.status === 204 ? {} : r.json();
  }
  const docPath = (path) => {
    if (!/^[^/]+(\/[^/]+)*$/.test(path) || path.split('/').length % 2) throw new Error(`not a document path: ${path}`);
    return `${docs}/${path.split('/').map(encodeURIComponent).join('/')}`;
  };
  const revokedPath = (uid) => {
    if (typeof uid !== 'string' || !uid || uid.includes('/')) throw new Error('bad uid');
    return `revoked/${uid}`;
  };
  const updateUser = (uid, fields) => call('POST', `${authBase}/v1/projects/${encodeURIComponent(project)}/accounts:update`, { localId: uid, ...fields });

  return {
    project,
    accessToken,
    // Firestore, as the service account (rules do not apply).
    async getDoc(path) { const d = await call('GET', docPath(path)); return d ? fromValue({ mapValue: { fields: d.fields || {} } }) : null; },
    setDoc: (path, data) => call('PATCH', docPath(path), toValue(data).mapValue),
    deleteDoc: (path) => call('DELETE', docPath(path)),
    // Claims on the account, in the kit's shape. {} clears them. They reach the user's next ID token.
    setClaims: async (uid, claims) => updateUser(uid, { customAttributes: JSON.stringify(claimsShape(claims)) }),
    // Refresh tokens issued before now stop working (the user signs in again within the hour their ID token has left).
    revokeSessions: (uid, now = Math.floor(Date.now() / 1000)) => updateUser(uid, { validSince: String(now) }),
    markRevoked: async (uid, at = new Date()) => call('PATCH', docPath(revokedPath(uid)), toValue({ at }).mapValue),
    clearRevoked: async (uid) => call('DELETE', docPath(revokedPath(uid))),
    // A member removed: rules refuse at once (revoked/{uid}), sessions end, claims cleared.
    async revoke(uid) {
      await this.markRevoked(uid);
      await this.setClaims(uid, {});
      await this.revokeSessions(uid);
    },
  };
}

const json = (body, status = 200) => new Response(JSON.stringify(body), { status,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' } });

// POST /api/claims with `Authorization: Bearer <ID token>`. options:
//   admin       admin(...) for the project, or null when the Worker is not set up yet (answers 503)
//   loadClaims  async ({ uid, token, admin }) => { g, x?, v } from the app's role docs, or null when the person is no
//               longer a member (claims are then cleared). Finding the role by email? Require token.email_verified.
//   origin      the app's own origin ('https://app.example.com'); other Origins get 403
//   limit       optional Workers rate-limit binding, keyed by the caller's address
//   verify      optional (idToken) => payload; defaults to verifyIdToken for admin.project
//   emulator    true in emulator tests only (demo- project): accepts unsigned ID tokens
// Answers { claims } (the page then calls getIdToken(true)), or { error } with 400/401/403/405/409/429/500/503.
export async function handleClaims(request, { admin: adm, loadClaims, origin, limit, verify, emulator = false } = {}) {
  if (request.method !== 'POST') return json({ error: 'POST only.' }, 405);
  if (!adm || typeof loadClaims !== 'function') return json({ error: 'Claims are not set up yet.' }, 503);
  const from = request.headers.get('Origin');
  if (origin && from && from !== origin) return json({ error: 'Wrong origin.' }, 403);
  if (limit) {
    const { success } = await limit.limit({ key: request.headers.get('CF-Connecting-IP') || 'unknown' });
    if (!success) return json({ error: 'Too many tries.' }, 429);
  }
  const idToken = (request.headers.get('Authorization') || '').match(/^Bearer\s+(\S+)$/)?.[1];
  if (!idToken) return json({ error: 'Sign in first.' }, 401);
  let token;
  try { token = await (verify ? verify(idToken) : verifyIdToken(idToken, { project: adm.project, emulator })); }
  catch (e) { return json({ error: 'Sign in again.', why: e?.message }, 401); }
  const provider = token.firebase?.sign_in_provider;
  if (provider === 'custom') return json({ error: 'This sign-in carries its own claims.' }, 409);
  try {
    const found = await loadClaims({ uid: token.sub, token, admin: adm });
    const m = PROVIDERS[provider];
    const claims = found ? claimsShape({ ...(m ? { m } : {}), ...found }) : {};
    await adm.setClaims(token.sub, claims);
    if (found) await adm.clearRevoked(token.sub);
    return json({ claims });
  } catch (e) {
    console.error('claims failed', e?.message);
    return json({ error: 'Couldn’t update your access. Try again.' }, 500);
  }
}
