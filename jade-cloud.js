// api/jade-cloud.js — JADE Tab shared workspace (Vercel + Supabase)

import crypto from "crypto";

const SUPABASE_URL = (process.env.SUPABASE_URL || "").replace(/\/$/, "");
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const SESSION_SECRET = process.env.JADE_SESSION_SECRET || "jade-default-secret-change-me";
const WORKSPACE_ID = process.env.JADE_WORKSPACE_ID || "default";
const TABLE = process.env.JADE_SUPABASE_TABLE || "jade_workspaces";
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

// ─── Supabase ─────────────────────────────────────────────────────────────────

function supaHeaders() {
  return {
    "Content-Type": "application/json",
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${SUPABASE_KEY}`,
    Prefer: "return=representation",
  };
}

async function dbGet() {
  const url = `${SUPABASE_URL}/rest/v1/${TABLE}?workspace_id=eq.${encodeURIComponent(WORKSPACE_ID)}&limit=1`;
  const res = await fetch(url, { headers: supaHeaders() });
  if (!res.ok) throw new Error(`Supabase GET ${res.status}: ${await res.text()}`);
  const rows = await res.json();
  return rows[0] || null;
}

async function dbUpsert(data) {
  const url = `${SUPABASE_URL}/rest/v1/${TABLE}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { ...supaHeaders(), Prefer: "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify({ workspace_id: WORKSPACE_ID, data, updated_at: new Date().toISOString() }),
  });
  if (!res.ok) throw new Error(`Supabase UPSERT ${res.status}: ${await res.text()}`);
  return res.json();
}

// ─── Tokens ───────────────────────────────────────────────────────────────────

function makeToken(email) {
  const payload = JSON.stringify({ email, ts: Date.now() });
  const hmac = crypto.createHmac("sha256", SESSION_SECRET).update(payload).digest("hex");
  return Buffer.from(payload).toString("base64url") + "." + hmac;
}

function verifyToken(token) {
  try {
    const [b64, sig] = String(token || "").split(".");
    if (!b64 || !sig) return null;
    const payload = Buffer.from(b64, "base64url").toString();
    const expected = crypto.createHmac("sha256", SESSION_SECRET).update(payload).digest("hex");
    if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
    const parsed = JSON.parse(payload);
    if (Date.now() - parsed.ts > SESSION_TTL_MS) return null;
    return parsed;
  } catch { return null; }
}

function makeAccessToken(userEmail) {
  const payload = JSON.stringify({ userEmail, access: true, ts: Date.now() });
  const hmac = crypto.createHmac("sha256", SESSION_SECRET).update(payload).digest("hex");
  return Buffer.from(payload).toString("base64url") + "." + hmac;
}

function verifyAccessToken(token) {
  try {
    const [b64, sig] = String(token || "").split(".");
    if (!b64 || !sig) return null;
    const payload = Buffer.from(b64, "base64url").toString();
    const expected = crypto.createHmac("sha256", SESSION_SECRET).update(payload).digest("hex");
    if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
    const parsed = JSON.parse(payload);
    if (Date.now() - parsed.ts > 30 * 24 * 60 * 60 * 1000) return null;
    if (!parsed.access) return null;
    return parsed;
  } catch { return null; }
}

// ─── Password check (mirrors front-end PBKDF2) ────────────────────────────────

async function verifyPassword(password, hash, salt, iterations = 210000) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), { name: "PBKDF2" }, false, ["deriveBits"]);
  const derived = await crypto.subtle.deriveBits({ name: "PBKDF2", salt: Buffer.from(salt, "hex"), iterations, hash: "SHA-256" }, key, 256);
  return Buffer.from(derived).toString("hex") === hash;
}

// ─── Actions ──────────────────────────────────────────────────────────────────

async function handleBootstrap() {
  const row = await dbGet();
  return { ok: true, initialized: Boolean(row), appSettings: row?.data?.appSettings || {} };
}

async function handleInitialize({ email, password, state }) {
  if (!email || !password || !state) return { ok: false, error: "email, password, and state are required." };
  const norm = email.trim().toLowerCase();
  const user = (state.users || []).find(u => u.email?.trim().toLowerCase() === norm);
  if (!user) return { ok: false, error: "No account found for that email in the provided state." };
  const ok = await verifyPassword(password, user.passwordHash, user.passwordSalt, user.passwordHashIterations);
  if (!ok) return { ok: false, error: "Incorrect password." };
  await dbUpsert(state);
  return { ok: true, initialized: true, sessionToken: makeToken(norm), state };
}

async function handleSignIn({ email, password }) {
  if (!email || !password) return { ok: false, error: "Email and password are required." };
  const norm = email.trim().toLowerCase();
  const row = await dbGet();
  if (!row) return { ok: false, code: "not_initialized", error: "Cloud workspace has not been initialized yet." };
  const user = (row.data?.users || []).find(u => u.email?.trim().toLowerCase() === norm);
  if (!user) return { ok: false, error: "No account found for that email address." };
  const ok = await verifyPassword(password, user.passwordHash, user.passwordSalt, user.passwordHashIterations);
  if (!ok) return { ok: false, error: "Incorrect password." };
  return { ok: true, initialized: true, sessionToken: makeToken(norm), state: row.data };
}

async function handleSignUp({ name, email, password, user: userRecord }) {
  if (!email) return { ok: false, error: "Email is required." };
  const norm = email.trim().toLowerCase();
  const row = await dbGet();
  if (!row) return { ok: false, code: "not_initialized", error: "Workspace not initialized. A manager must sign in first." };
  if (!row.data?.appSettings?.auth?.allowSelfSignUp) return { ok: false, error: "Self sign-up is not currently enabled." };
  if ((row.data?.users || []).some(u => u.email?.trim().toLowerCase() === norm)) return { ok: false, error: "An account with that email already exists." };
  if (!userRecord?.passwordHash) return { ok: false, code: "send_user_record", error: "Send the full hashed user record via the 'user' field." };
  const newState = { ...row.data, users: [...(row.data.users || []), userRecord] };
  await dbUpsert(newState);
  return { ok: true, initialized: true, sessionToken: makeToken(norm), state: newState };
}

async function handleGetState({ sessionToken }) {
  const session = verifyToken(sessionToken);
  if (!session) return { ok: false, code: "unauthorized", error: "Invalid or expired session." };
  const row = await dbGet();
  if (!row) return { ok: false, code: "not_initialized", error: "Workspace not initialized." };
  return { ok: true, initialized: true, state: row.data };
}

async function handlePersist({ sessionToken, state }) {
  const session = verifyToken(sessionToken);
  if (!session) return { ok: false, code: "unauthorized", error: "Invalid or expired session." };
  if (!state || typeof state !== "object") return { ok: false, error: "Invalid state." };
  await dbUpsert(state);
  return { ok: true, initialized: true };
}

async function handleAccessLink({ token }) {
  const parsed = verifyAccessToken(token);
  if (!parsed) return { ok: false, code: "invalid_link", error: "This access link is invalid or has expired." };
  const norm = parsed.userEmail?.trim().toLowerCase();
  const row = await dbGet();
  if (!row) return { ok: false, code: "not_initialized", error: "Workspace not initialized." };
  const user = (row.data?.users || []).find(u => u.email?.trim().toLowerCase() === norm);
  if (!user) return { ok: false, error: "No account found for that access link." };
  return { ok: true, initialized: true, sessionToken: makeToken(norm), userEmail: norm, state: row.data };
}

async function handlePasswordResetRequest({ email, note }) {
  if (!email) return { ok: false, error: "Email is required." };
  const norm = email.trim().toLowerCase();
  const row = await dbGet();
  if (!row) return { ok: true }; // silent — don't reveal workspace state
  const request = { id: crypto.randomUUID(), email: norm, note: String(note || "").trim(), requestedAt: new Date().toISOString(), resolved: false };
  const newState = { ...row.data, recoveryRequests: [...(row.data?.recoveryRequests || []), request] };
  await dbUpsert(newState);
  return { ok: true };
}

// ─── Main export ──────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Accept");

  if (req.method === "OPTIONS") return res.status(204).end();

  // GET — health probe. Always return ok:true so the app detects cloud mode.
  // If Supabase isn't configured yet the app will show setup prompts instead of
  // silently falling back to localStorage.
  if (req.method === "GET") {
    const supabaseReady = Boolean(SUPABASE_URL && SUPABASE_KEY);
    let initialized = false;
    if (supabaseReady) {
      try { initialized = Boolean(await dbGet()); } catch { /* not fatal */ }
    }
    return res.status(200).json({ ok: true, initialized, supabaseReady, service: "jade-cloud", ts: Date.now() });
  }

  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method not allowed." });

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return res.status(503).json({ ok: false, error: "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are not set in Vercel environment variables." });
  }

  let body = {};
  try { body = typeof req.body === "object" ? req.body : JSON.parse(req.body || "{}"); }
  catch { return res.status(400).json({ ok: false, error: "Invalid JSON." }); }

  const { action, ...payload } = body;

  try {
    let result;
    switch (action) {
      case "bootstrap":              result = await handleBootstrap(); break;
      case "initialize":             result = await handleInitialize(payload); break;
      case "sign_in":                result = await handleSignIn(payload); break;
      case "sign_up":                result = await handleSignUp(payload); break;
      case "get_state":              result = await handleGetState(payload); break;
      case "persist":                result = await handlePersist(payload); break;
      case "access_link":            result = await handleAccessLink(payload); break;
      case "request_password_reset": result = await handlePasswordResetRequest(payload); break;
      default: result = { ok: false, error: `Unknown action: ${action}` };
    }
    return res.status(result.ok === false ? 400 : 200).json(result);
  } catch (err) {
    console.error("[jade-cloud]", err);
    return res.status(500).json({ ok: false, error: err.message || "Unexpected error." });
  }
}
