// api/jade-cloud.js — JADE Tab shared workspace (Vercel + Supabase)
//
// Required environment variables (set in Vercel project settings):
//   SUPABASE_URL               — e.g. https://xxxx.supabase.co
//   SUPABASE_SERVICE_ROLE_KEY  — service role key (not the anon key)
//   JADE_SESSION_SECRET        — any long random string (32+ chars)
//
// Optional:
//   JADE_WORKSPACE_ID          — defaults to "default"
//   JADE_SUPABASE_TABLE        — defaults to "jade_workspaces"

import crypto from "crypto";

// ─── Config ──────────────────────────────────────────────────────────────────

const SUPABASE_URL = (process.env.SUPABASE_URL || "").replace(/\/$/, "");
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const SESSION_SECRET = process.env.JADE_SESSION_SECRET || "jade-default-secret-change-me";
const WORKSPACE_ID = process.env.JADE_WORKSPACE_ID || "default";
const TABLE = process.env.JADE_SUPABASE_TABLE || "jade_workspaces";
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// ─── Supabase helpers ─────────────────────────────────────────────────────────

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
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Supabase GET failed: ${res.status} ${text}`);
  }
  const rows = await res.json();
  return rows[0] || null;
}

async function dbUpsert(data) {
  const url = `${SUPABASE_URL}/rest/v1/${TABLE}`;
  const body = JSON.stringify({
    workspace_id: WORKSPACE_ID,
    data,
    updated_at: new Date().toISOString(),
  });
  const res = await fetch(url, {
    method: "POST",
    headers: {
      ...supaHeaders(),
      Prefer: "resolution=merge-duplicates,return=representation",
    },
    body,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Supabase UPSERT failed: ${res.status} ${text}`);
  }
  return await res.json();
}

// ─── Session tokens ───────────────────────────────────────────────────────────

function makeToken(email) {
  const payload = JSON.stringify({ email, ts: Date.now() });
  const hmac = crypto
    .createHmac("sha256", SESSION_SECRET)
    .update(payload)
    .digest("hex");
  return Buffer.from(payload).toString("base64url") + "." + hmac;
}

function verifyToken(token) {
  try {
    const [b64, sig] = String(token || "").split(".");
    if (!b64 || !sig) return null;
    const payload = Buffer.from(b64, "base64url").toString();
    const expected = crypto
      .createHmac("sha256", SESSION_SECRET)
      .update(payload)
      .digest("hex");
    if (
      sig.length !== expected.length ||
      !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))
    ) {
      return null;
    }
    const parsed = JSON.parse(payload);
    if (Date.now() - parsed.ts > SESSION_TTL_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}

function makeAccessLinkToken(userEmail) {
  const payload = JSON.stringify({ userEmail, access: true, ts: Date.now() });
  const hmac = crypto
    .createHmac("sha256", SESSION_SECRET)
    .update(payload)
    .digest("hex");
  return Buffer.from(payload).toString("base64url") + "." + hmac;
}

function verifyAccessLinkToken(token) {
  try {
    const [b64, sig] = String(token || "").split(".");
    if (!b64 || !sig) return null;
    const payload = Buffer.from(b64, "base64url").toString();
    const expected = crypto
      .createHmac("sha256", SESSION_SECRET)
      .update(payload)
      .digest("hex");
    if (
      sig.length !== expected.length ||
      !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))
    ) {
      return null;
    }
    const parsed = JSON.parse(payload);
    // Access links are valid for 30 days
    if (Date.now() - parsed.ts > 30 * 24 * 60 * 60 * 1000) return null;
    if (!parsed.access) return null;
    return parsed;
  } catch {
    return null;
  }
}

// ─── Password verification (mirrors the front-end PBKDF2 logic) ───────────────

async function verifyPassword(password, storedHash, storedSalt, iterations = 210000) {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    enc.encode(password),
    { name: "PBKDF2" },
    false,
    ["deriveBits"]
  );
  const saltBuf = Buffer.from(storedSalt, "hex");
  const derived = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: saltBuf,
      iterations,
      hash: "SHA-256",
    },
    keyMaterial,
    256
  );
  const derivedHex = Buffer.from(derived).toString("hex");
  return derivedHex === storedHash;
}

// ─── State helpers ────────────────────────────────────────────────────────────

function safeState(raw) {
  // Accept any object as the workspace state blob
  if (!raw || typeof raw !== "object") return null;
  return raw;
}

// ─── Action handlers ──────────────────────────────────────────────────────────

async function handleBootstrap() {
  const row = await dbGet();
  if (!row) {
    return { ok: true, initialized: false, appSettings: {} };
  }
  const st = safeState(row.data);
  return {
    ok: true,
    initialized: true,
    appSettings: st?.appSettings || {},
  };
}

async function handleInitialize(payload) {
  const { email, password, state } = payload;
  if (!email || !password || !state) {
    return { ok: false, error: "email, password, and state are required." };
  }

  const normalEmail = String(email).trim().toLowerCase();
  const st = safeState(state);
  if (!st) {
    return { ok: false, error: "Invalid state object." };
  }

  // Verify the initializing user exists in the state and credentials match
  const user = (st.users || []).find(
    (u) => String(u.email || "").trim().toLowerCase() === normalEmail
  );
  if (!user) {
    return { ok: false, error: "No account found for that email in the provided state." };
  }

  // Check password against stored hash
  const passwordOk = await verifyPassword(
    password,
    user.passwordHash,
    user.passwordSalt,
    user.passwordHashIterations || 210000
  );
  if (!passwordOk) {
    return { ok: false, error: "Incorrect password." };
  }

  await dbUpsert(st);

  const sessionToken = makeToken(normalEmail);
  return { ok: true, initialized: true, sessionToken, state: st };
}

async function handleSignIn(payload) {
  const { email, password } = payload;
  if (!email || !password) {
    return { ok: false, error: "Email and password are required." };
  }

  const normalEmail = String(email).trim().toLowerCase();
  const row = await dbGet();
  if (!row) {
    return {
      ok: false,
      code: "not_initialized",
      error: "Cloud workspace has not been initialized yet.",
    };
  }

  const st = safeState(row.data);
  const user = (st?.users || []).find(
    (u) => String(u.email || "").trim().toLowerCase() === normalEmail
  );
  if (!user) {
    return { ok: false, error: "No account found for that email address." };
  }

  const passwordOk = await verifyPassword(
    password,
    user.passwordHash,
    user.passwordSalt,
    user.passwordHashIterations || 210000
  );
  if (!passwordOk) {
    return { ok: false, error: "Incorrect password." };
  }

  const sessionToken = makeToken(normalEmail);
  return { ok: true, initialized: true, sessionToken, state: st };
}

async function handleSignUp(payload) {
  const { name, email, password } = payload;
  if (!name || !email || !password) {
    return { ok: false, error: "Name, email, and password are required." };
  }

  const normalEmail = String(email).trim().toLowerCase();
  const row = await dbGet();
  if (!row) {
    return {
      ok: false,
      code: "not_initialized",
      error: "Cloud workspace has not been initialized yet. A manager must sign in first.",
    };
  }

  const st = safeState(row.data);
  const existing = (st?.users || []).find(
    (u) => String(u.email || "").trim().toLowerCase() === normalEmail
  );
  if (existing) {
    return { ok: false, error: "An account with that email already exists." };
  }

  // Check if self sign-up is allowed
  if (!st?.appSettings?.auth?.allowSelfSignUp) {
    return { ok: false, error: "Self sign-up is not currently enabled." };
  }

  // The front-end already built the password hash — we trust it.
  // But for sign_up we expect the client to send a pre-hashed user record.
  // If they sent a plain password, we cannot hash it here without the full PBKDF2 params.
  // The client sends { name, email, password } — we must reject plain passwords server-side
  // and tell the client to send a user record instead. However, the current front-end
  // sends the full result.state back after calling sign_up, so we look for the user
  // in the state sent along (if provided), or we return an error asking for a full record.
  if (payload.user && payload.user.passwordHash) {
    const newUser = payload.user;
    const newState = { ...st, users: [...(st.users || []), newUser] };
    await dbUpsert(newState);
    const sessionToken = makeToken(normalEmail);
    return { ok: true, initialized: true, sessionToken, state: newState };
  }

  // Fallback: cannot hash plain password server-side — tell the client.
  return {
    ok: false,
    code: "send_user_record",
    error:
      "Send the full hashed user record via the 'user' field to complete sign-up.",
  };
}

async function handleGetState(payload) {
  const { sessionToken } = payload;
  const session = verifyToken(sessionToken);
  if (!session) {
    return { ok: false, code: "unauthorized", error: "Invalid or expired session." };
  }

  const row = await dbGet();
  if (!row) {
    return { ok: false, code: "not_initialized", error: "Workspace not initialized." };
  }

  return { ok: true, initialized: true, state: safeState(row.data) };
}

async function handlePersist(payload) {
  const { sessionToken, state } = payload;
  const session = verifyToken(sessionToken);
  if (!session) {
    return { ok: false, code: "unauthorized", error: "Invalid or expired session." };
  }

  const st = safeState(state);
  if (!st) {
    return { ok: false, error: "Invalid state object." };
  }

  await dbUpsert(st);
  return { ok: true, initialized: true };
}

async function handleAccessLink(payload) {
  const { token } = payload;
  const parsed = verifyAccessLinkToken(token);
  if (!parsed) {
    return { ok: false, code: "invalid_link", error: "This access link is invalid or has expired." };
  }

  const normalEmail = String(parsed.userEmail || "").trim().toLowerCase();
  const row = await dbGet();
  if (!row) {
    return { ok: false, code: "not_initialized", error: "Workspace not initialized." };
  }

  const st = safeState(row.data);
  const user = (st?.users || []).find(
    (u) => String(u.email || "").trim().toLowerCase() === normalEmail
  );
  if (!user) {
    return { ok: false, error: "No account found for that access link." };
  }

  const sessionToken = makeToken(normalEmail);
  return { ok: true, initialized: true, sessionToken, userEmail: normalEmail, state: st };
}

async function handleRequestPasswordReset(payload) {
  const { email, note } = payload;
  if (!email) {
    return { ok: false, error: "Email is required." };
  }

  const normalEmail = String(email).trim().toLowerCase();
  const row = await dbGet();
  if (!row) {
    return { ok: true }; // Silent success — don't reveal workspace state
  }

  const st = safeState(row.data);
  if (!st) return { ok: true };

  const request = {
    id: crypto.randomUUID(),
    email: normalEmail,
    note: String(note || "").trim(),
    requestedAt: new Date().toISOString(),
    resolved: false,
  };

  const updatedState = {
    ...st,
    recoveryRequests: [...(st.recoveryRequests || []), request],
  };

  await dbUpsert(updatedState);
  return { ok: true };
}

// ─── Main handler ─────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Accept");

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  // Health probe (GET)
  if (req.method === "GET") {
    try {
      const row = await dbGet();
      return res.status(200).json({
        ok: true,
        initialized: Boolean(row),
        service: "jade-cloud",
        ts: Date.now(),
      });
    } catch (err) {
      return res.status(200).json({
        ok: false,
        initialized: false,
        error: err.message,
        ts: Date.now(),
      });
    }
  }

  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed." });
  }

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return res.status(503).json({
      ok: false,
      error: "Cloud backend is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in Vercel.",
    });
  }

  let body = {};
  try {
    body = typeof req.body === "object" ? req.body : JSON.parse(req.body || "{}");
  } catch {
    return res.status(400).json({ ok: false, error: "Invalid JSON body." });
  }

  const { action, ...payload } = body;

  try {
    let result;
    switch (action) {
      case "bootstrap":
        result = await handleBootstrap();
        break;
      case "initialize":
        result = await handleInitialize(payload);
        break;
      case "sign_in":
        result = await handleSignIn(payload);
        break;
      case "sign_up":
        result = await handleSignUp(payload);
        break;
      case "get_state":
        result = await handleGetState(payload);
        break;
      case "persist":
        result = await handlePersist(payload);
        break;
      case "access_link":
        result = await handleAccessLink(payload);
        break;
      case "request_password_reset":
        result = await handleRequestPasswordReset(payload);
        break;
      default:
        result = { ok: false, error: `Unknown action: ${action}` };
    }

    if (result.ok === false) {
      return res.status(400).json(result);
    }
    return res.status(200).json(result);
  } catch (err) {
    console.error("[jade-cloud] Error:", err);
    return res.status(500).json({
      ok: false,
      error: err.message || "An unexpected error occurred.",
    });
  }
}
