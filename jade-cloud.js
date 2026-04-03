const crypto = require("node:crypto");

const WORKSPACE_TABLE = process.env.JADE_SUPABASE_TABLE || "jade_workspaces";
const WORKSPACE_ID = process.env.JADE_WORKSPACE_ID || "primary";
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 14;
const PASSWORD_HASH_VERSION = "pbkdf2-sha256-v1";
const PASSWORD_HASH_ITERATIONS = 210000;
const PASSWORD_SALT_BYTES = 16;

function nowText() {
  return new Date().toLocaleString("en-US", {
    timeZone: "America/Jamaica",
  });
}

function normalizeEmail(value = "") {
  return String(value || "").trim().toLowerCase();
}

function normalizeGlobalRole(value = "member") {
  const normalized = String(value || "")
    .trim()
    .toLowerCase()
    .replaceAll(" ", "_")
    .replaceAll("-", "_");

  if (["system_admin", "system_manager", "admin", "administrator"].includes(normalized)) {
    return "system_admin";
  }

  if (normalized === "manager") {
    return "manager";
  }

  return "member";
}

function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
    body: JSON.stringify(body),
  };
}

function createPasswordSalt() {
  return crypto.randomBytes(PASSWORD_SALT_BYTES).toString("hex");
}

function deriveSecurePasswordHash(password, salt, iterations = PASSWORD_HASH_ITERATIONS) {
  return crypto
    .pbkdf2Sync(
      Buffer.from(String(password || ""), "utf8"),
      Buffer.from(String(salt || ""), "hex"),
      Number(iterations) || PASSWORD_HASH_ITERATIONS,
      32,
      "sha256",
    )
    .toString("hex");
}

function hashLegacyPassword(password) {
  return crypto.createHash("sha256").update(String(password || ""), "utf8").digest("hex");
}

function buildSecurePasswordRecord(password) {
  const passwordSalt = createPasswordSalt();
  return {
    passwordHash: deriveSecurePasswordHash(password, passwordSalt),
    passwordSalt,
    passwordIterations: PASSWORD_HASH_ITERATIONS,
    passwordVersion: PASSWORD_HASH_VERSION,
  };
}

function verifyUserPassword(user = {}, password = "") {
  if (
    user.passwordVersion === PASSWORD_HASH_VERSION &&
    user.passwordSalt &&
    user.passwordHash
  ) {
    const computedHash = deriveSecurePasswordHash(
      password,
      user.passwordSalt,
      user.passwordIterations,
    );
    return {
      ok: computedHash === user.passwordHash,
      needsUpgrade: false,
    };
  }

  const legacyHash = hashLegacyPassword(password);
  const matches = legacyHash === String(user.passwordHash || "");
  return {
    ok: matches,
    needsUpgrade: matches,
  };
}

function getRequiredEnv(name) {
  const value = String(process.env[name] || "").trim();
  if (!value) {
    throw new Error("Missing environment variable: " + name);
  }
  return value;
}

async function supabaseRequest(pathname, options = {}) {
  const supabaseUrl = getRequiredEnv("SUPABASE_URL");
  const serviceKey = getRequiredEnv("SUPABASE_SERVICE_ROLE_KEY");
  const url = new URL(pathname, supabaseUrl.endsWith("/") ? supabaseUrl : supabaseUrl + "/");
  const response = await fetch(url, {
    method: options.method || "GET",
    headers: {
      apikey: serviceKey,
      Authorization: "Bearer " + serviceKey,
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch (error) {
    payload = text;
  }

  if (!response.ok) {
    const message =
      payload?.message ||
      payload?.error_description ||
      payload?.error ||
      text ||
      "Supabase request failed.";
    const failure = new Error(String(message));
    failure.statusCode = response.status;
    throw failure;
  }

  return payload;
}

async function readWorkspaceState() {
  const path = `/rest/v1/${WORKSPACE_TABLE}?id=eq.${encodeURIComponent(
    WORKSPACE_ID,
  )}&select=id,state,updated_at`;
  const rows = await supabaseRequest(path);
  if (!Array.isArray(rows) || !rows.length) {
    return null;
  }
  return rows[0].state || null;
}

async function writeWorkspaceState(state) {
  const rows = await supabaseRequest(`/rest/v1/${WORKSPACE_TABLE}?on_conflict=id`, {
    method: "POST",
    headers: {
      Prefer: "resolution=merge-duplicates,return=representation",
    },
    body: [
      {
        id: WORKSPACE_ID,
        state,
        updated_at: new Date().toISOString(),
      },
    ],
  });

  return Array.isArray(rows) && rows.length ? rows[0].state || state : state;
}

function signSessionToken(email) {
  const secret = getRequiredEnv("JADE_SESSION_SECRET");
  const payload = {
    workspaceId: WORKSPACE_ID,
    email: normalizeEmail(email),
    iat: Date.now(),
    exp: Date.now() + SESSION_TTL_MS,
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = crypto
    .createHmac("sha256", secret)
    .update(encodedPayload)
    .digest("base64url");
  return encodedPayload + "." + signature;
}

function verifySessionToken(token) {
  const secret = getRequiredEnv("JADE_SESSION_SECRET");
  const raw = String(token || "").trim();
  if (!raw.includes(".")) {
    return null;
  }

  const [encodedPayload, signature] = raw.split(".");
  const expectedSignature = crypto
    .createHmac("sha256", secret)
    .update(encodedPayload)
    .digest("base64url");

  if (!signature || signature.length !== expectedSignature.length) {
    return null;
  }

  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature))) {
    return null;
  }

  try {
    const payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8"));
    if (
      payload.workspaceId !== WORKSPACE_ID ||
      !payload.email ||
      Number(payload.exp || 0) < Date.now()
    ) {
      return null;
    }
    return payload;
  } catch (error) {
    return null;
  }
}

function getUserByEmail(state, email) {
  return (state?.users || []).find((user) => normalizeEmail(user.email) === normalizeEmail(email));
}

function getUserByPrivateAccessToken(state, token) {
  const target = String(token || "").trim();
  return (state?.users || []).find(
    (user) => String(user.privateAccessToken || "").trim() === target,
  );
}

function buildPublicBootstrap(state) {
  return {
    appSettings: state?.appSettings || {},
    initialized: Boolean(state),
  };
}

function assertWorkspaceState(state) {
  if (!state || typeof state !== "object" || Array.isArray(state)) {
    throw new Error("A valid JADE workspace payload is required.");
  }
  return state;
}

exports.handler = async (event) => {
  try {
    if (event.httpMethod === "GET") {
      const workspaceState = await readWorkspaceState();
      return json(200, {
        ok: true,
        initialized: Boolean(workspaceState),
      });
    }

    if (event.httpMethod !== "POST") {
      return json(405, {
        ok: false,
        error: "Method not allowed.",
      });
    }

    const body = event.body ? JSON.parse(event.body) : {};
    const action = String(body.action || "").trim().toLowerCase();

    if (action === "bootstrap") {
      const workspaceState = await readWorkspaceState();
      return json(200, {
        ok: true,
        ...buildPublicBootstrap(workspaceState),
      });
    }

    if (action === "initialize") {
      const existingState = await readWorkspaceState();
      if (existingState) {
        return json(409, {
          ok: false,
          code: "workspace_already_initialized",
          error: "The shared JADE workspace has already been initialized.",
        });
      }

      const seedState = assertWorkspaceState(body.state);
      const email = normalizeEmail(body.email);
      const password = String(body.password || "");
      const user = getUserByEmail(seedState, email);

      if (!user) {
        return json(404, {
          ok: false,
          code: "account_not_found",
          error: "That account could not be found in the local JADE workspace you are trying to publish.",
        });
      }

      const passwordCheck = verifyUserPassword(user, password);
      if (!passwordCheck.ok) {
        return json(401, {
          ok: false,
          code: "invalid_credentials",
          error: "Incorrect password.",
        });
      }

      if (!user.active) {
        return json(403, {
          ok: false,
          code: "account_disabled",
          error: "This account is disabled.",
        });
      }

      const role = normalizeGlobalRole(user.globalRole);
      if (!["manager", "system_admin"].includes(role)) {
        return json(403, {
          ok: false,
          code: "manager_required",
          error: "Only a System Manager can initialize the shared JADE workspace.",
        });
      }

      const publishedState = JSON.parse(JSON.stringify(seedState));
      const publishedUser = getUserByEmail(publishedState, email);
      publishedUser.lastLoginAt = nowText();
      if (passwordCheck.needsUpgrade) {
        Object.assign(publishedUser, buildSecurePasswordRecord(password));
      }

      const savedState = await writeWorkspaceState(publishedState);
      return json(200, {
        ok: true,
        initialized: true,
        state: savedState,
        sessionToken: signSessionToken(email),
        userEmail: email,
      });
    }

    const workspaceState = await readWorkspaceState();
    if (!workspaceState) {
      return json(409, {
        ok: false,
        code: "workspace_not_initialized",
        error:
          "The shared JADE workspace has not been initialized yet. A System Manager should sign in from the original setup device first.",
      });
    }

    if (action === "sign_in") {
      const email = normalizeEmail(body.email);
      const password = String(body.password || "");
      const stateCopy = JSON.parse(JSON.stringify(workspaceState));
      const user = getUserByEmail(stateCopy, email);

      if (!user) {
        return json(404, {
          ok: false,
          code: "account_not_found",
          error: "No account exists for that email address.",
        });
      }

      if (!user.active) {
        return json(403, {
          ok: false,
          code: "account_disabled",
          error: "This account has been disabled by the manager.",
        });
      }

      const passwordCheck = verifyUserPassword(user, password);
      if (!passwordCheck.ok) {
        return json(401, {
          ok: false,
          code: "invalid_credentials",
          error: "Incorrect password.",
        });
      }

      user.lastLoginAt = nowText();
      if (passwordCheck.needsUpgrade) {
        Object.assign(user, buildSecurePasswordRecord(password));
      }

      const savedState = await writeWorkspaceState(stateCopy);
      return json(200, {
        ok: true,
        initialized: true,
        state: savedState,
        sessionToken: signSessionToken(email),
        userEmail: email,
      });
    }

    if (action === "sign_up") {
      const name = String(body.name || "").trim();
      const email = normalizeEmail(body.email);
      const password = String(body.password || "");
      const stateCopy = JSON.parse(JSON.stringify(workspaceState));

      if (!stateCopy?.appSettings?.auth?.allowSelfSignup) {
        return json(403, {
          ok: false,
          code: "signup_disabled",
          error: "Self sign-up is currently disabled.",
        });
      }

      if (!name || !email) {
        return json(400, {
          ok: false,
          code: "missing_fields",
          error: "Name and email are required.",
        });
      }

      if (
        String(password || "").length <
        Number(stateCopy?.appSettings?.auth?.minimumPasswordLength || 12)
      ) {
        return json(400, {
          ok: false,
          code: "password_too_short",
          error:
            "Password must be at least " +
            Number(stateCopy?.appSettings?.auth?.minimumPasswordLength || 12) +
            " characters long.",
        });
      }

      if (getUserByEmail(stateCopy, email)) {
        return json(409, {
          ok: false,
          code: "account_exists",
          error: "An account with that email already exists.",
        });
      }

      stateCopy.users = Array.isArray(stateCopy.users) ? stateCopy.users : [];
      stateCopy.users.push({
        id: "user-" + Math.random().toString(36).slice(2, 10),
        name,
        email,
        ...buildSecurePasswordRecord(password),
        globalRole: "member",
        createdAt: nowText(),
        createdAtKey: Date.now(),
        createdSource: "self_signup",
        createdBy: email,
        lastLoginAt: nowText(),
        active: true,
        privateAccessToken: "access-" + Math.random().toString(36).slice(2, 10),
        privateAccessIssuedAt: nowText(),
        lastPrivateAccessAt: "",
        pinnedTournamentIds: [],
        themePreset: "jade_classic",
        preferredLandingView: "overview",
      });

      const savedState = await writeWorkspaceState(stateCopy);
      return json(200, {
        ok: true,
        initialized: true,
        state: savedState,
        sessionToken: signSessionToken(email),
        userEmail: email,
      });
    }

    if (action === "request_password_reset") {
      const email = normalizeEmail(body.email);
      const note = String(body.note || "").trim();
      const stateCopy = JSON.parse(JSON.stringify(workspaceState));
      const knownAccount = Boolean(getUserByEmail(stateCopy, email));
      const submittedAt = nowText();
      const submittedAtKey = Date.now();

      stateCopy.recoveryRequests = Array.isArray(stateCopy.recoveryRequests)
        ? stateCopy.recoveryRequests
        : [];

      const existing = stateCopy.recoveryRequests.find(
        (request) => normalizeEmail(request.email) === email && request.status === "open",
      );

      if (existing) {
        existing.note = note || existing.note;
        existing.knownAccount = knownAccount;
        existing.submittedAt = submittedAt;
        existing.submittedAtKey = submittedAtKey;
      } else {
        stateCopy.recoveryRequests.unshift({
          id: "recovery-" + Math.random().toString(36).slice(2, 10),
          email,
          note,
          knownAccount,
          submittedAt,
          submittedAtKey,
          status: "open",
          resolvedAt: "",
          resolvedBy: "",
        });
      }

      await writeWorkspaceState(stateCopy);
      return json(200, {
        ok: true,
        initialized: true,
      });
    }

    if (action === "access_link") {
      const token = String(body.token || "").trim();
      const stateCopy = JSON.parse(JSON.stringify(workspaceState));
      const user = getUserByPrivateAccessToken(stateCopy, token);

      if (!user) {
        return json(404, {
          ok: false,
          code: "invalid_access_link",
          error: "That private access URL is no longer valid.",
        });
      }

      if (!user.active) {
        return json(403, {
          ok: false,
          code: "account_disabled",
          error: "This private access URL belongs to a disabled account.",
        });
      }

      user.lastLoginAt = nowText();
      user.lastPrivateAccessAt = nowText();

      const savedState = await writeWorkspaceState(stateCopy);
      return json(200, {
        ok: true,
        initialized: true,
        state: savedState,
        sessionToken: signSessionToken(user.email),
        userEmail: user.email,
      });
    }

    if (action === "get_state") {
      const sessionPayload = verifySessionToken(body.sessionToken);
      if (!sessionPayload) {
        return json(401, {
          ok: false,
          code: "invalid_session",
          error: "Your JADE cloud session is no longer valid. Please sign in again.",
        });
      }

      const user = getUserByEmail(workspaceState, sessionPayload.email);
      if (!user || !user.active) {
        return json(401, {
          ok: false,
          code: "invalid_session",
          error: "Your JADE cloud session is no longer valid. Please sign in again.",
        });
      }

      return json(200, {
        ok: true,
        initialized: true,
        state: workspaceState,
        userEmail: sessionPayload.email,
      });
    }

    if (action === "persist") {
      const sessionPayload = verifySessionToken(body.sessionToken);
      if (!sessionPayload) {
        return json(401, {
          ok: false,
          code: "invalid_session",
          error: "Your JADE cloud session is no longer valid. Please sign in again.",
        });
      }

      const currentUser = getUserByEmail(workspaceState, sessionPayload.email);
      if (!currentUser || !currentUser.active) {
        return json(401, {
          ok: false,
          code: "invalid_session",
          error: "Your JADE cloud session is no longer valid. Please sign in again.",
        });
      }

      const nextState = assertWorkspaceState(body.state);
      const savedState = await writeWorkspaceState(nextState);
      return json(200, {
        ok: true,
        initialized: true,
        state: savedState,
      });
    }

    return json(400, {
      ok: false,
      code: "unknown_action",
      error: "That JADE cloud action is not supported.",
    });
  } catch (error) {
    console.error(error);
    return json(500, {
      ok: false,
      code: "server_error",
      error: error.message || "JADE cloud request failed.",
    });
  }
};
