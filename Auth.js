/**
 * auth.js — Simple Reddit-style auth
 * Username + password, no email, no verification.
 * JWT stored in localStorage on client, passed as Authorization header.
 *
 * Requires in .env:
 *   JWT_SECRET=any-long-random-string
 *   BCRYPT_ROUNDS=10  (optional, defaults to 10)
 *
 * Supabase auth migration:
 *   see the latest auth-related SQL file in supabase/migrations
 */

import { createClient } from "@supabase/supabase-js";
import crypto from "node:crypto";

// ── Minimal bcrypt-compatible PBKDF2 (no native bcrypt module needed) ─────────
// Uses Node built-in crypto — no extra npm install required.
const ROUNDS = Math.max(1, Number(process.env.BCRYPT_ROUNDS) || 10);
const ITERATIONS = 10000 * ROUNDS; // scale with ROUNDS setting

async function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const dk = await pbkdf2(password, salt);
  return `pbkdf2:${salt}:${dk}`;
}

async function verifyPassword(password, stored) {
  const parts = String(stored || "").split(":");
  if (parts.length !== 3 || parts[0] !== "pbkdf2") return false;
  const [, salt, expected] = parts;
  const actual = await pbkdf2(password, salt);
  // Constant-time comparison
  return crypto.timingSafeEqual(Buffer.from(actual, "hex"), Buffer.from(expected, "hex"));
}

function pbkdf2(password, salt) {
  return new Promise((resolve, reject) =>
    crypto.pbkdf2(password, salt, ITERATIONS, 32, "sha256", (err, dk) =>
      err ? reject(err) : resolve(dk.toString("hex"))
    )
  );
}

// ── Minimal JWT (no jsonwebtoken dep needed) ──────────────────────────────────
const JWT_SECRET = process.env.JWT_SECRET || "change-me-in-production-use-a-long-random-string";
const JWT_EXPIRY_HOURS = 72;

function b64url(buf) {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

function signJwt(payload) {
  const header = b64url(Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })));
  const body   = b64url(Buffer.from(JSON.stringify(payload)));
  const sig    = b64url(crypto.createHmac("sha256", JWT_SECRET).update(`${header}.${body}`).digest());
  return `${header}.${body}.${sig}`;
}

function verifyJwt(token) {
  if (!token) return null;
  const parts = String(token).split(".");
  if (parts.length !== 3) return null;
  const [header, body, sig] = parts;
  const expected = b64url(crypto.createHmac("sha256", JWT_SECRET).update(`${header}.${body}`).digest());
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64").toString());
    if (payload.exp && Date.now() / 1000 > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

function makeToken(userId, username) {
  return signJwt({
    sub: userId,
    username,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 3600 * JWT_EXPIRY_HOURS,
  });
}

// ── Auth middleware ────────────────────────────────────────────────────────────
export function authMiddleware(req, res, next) {
  const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  const payload = verifyJwt(token);
  req.user = payload ? { id: payload.sub, username: payload.username } : null;
  next();
}

export function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: "Authentication required." });
  next();
}

async function findUserByUsername(supabase, username) {
  const rpc = await supabase.rpc("auth_get_user_by_username", {
    p_username: username,
  });

  if (!rpc.error) {
    const user = Array.isArray(rpc.data) ? rpc.data[0] : rpc.data;
    return { data: user || null, error: null };
  }

  const fallback = await supabase
    .from("cad_users")
    .select("id, username, password_hash, created_at")
    .eq("username", username)
    .maybeSingle();

  return fallback;
}

async function createUserRecord(supabase, username, passwordHash) {
  const rpc = await supabase.rpc("auth_create_user", {
    p_username: username,
    p_password_hash: passwordHash,
  });

  if (!rpc.error) {
    const user = Array.isArray(rpc.data) ? rpc.data[0] : rpc.data;
    return { data: user || null, error: null };
  }

  return supabase
    .from("cad_users")
    .insert([{ username, password_hash: passwordHash }])
    .select("id, username, created_at")
    .single();
}

// ── Route handlers ────────────────────────────────────────────────────────────
export function createAuthRouter(supabase) {
  const routes = {};

  // POST /auth/signup
  routes.signup = async (req, res) => {
    const username = String(req.body.username || "").trim().toLowerCase();
    const password = String(req.body.password || "");

    if (!username || username.length < 3 || username.length > 30)
      return res.status(400).json({ error: "Username must be 3–30 characters." });
    if (!/^[a-z0-9_-]+$/.test(username))
      return res.status(400).json({ error: "Username may only contain letters, numbers, hyphens, and underscores." });
    if (!password || password.length < 6)
      return res.status(400).json({ error: "Password must be at least 6 characters." });

    if (!supabase) return res.status(503).json({ error: "Database not configured." });

    // Check if username taken
    const { data: existing, error: existingError } = await findUserByUsername(supabase, username);
    if (existingError) {
      console.error("[Auth] Signup lookup error:", existingError.message);
      return res.status(500).json({ error: "Could not verify username availability." });
    }

    if (existing) return res.status(409).json({ error: "Username already taken." });

    const passwordHash = await hashPassword(password);
    const { data: user, error } = await createUserRecord(supabase, username, passwordHash);

    if (error) {
      console.error("[Auth] Signup error:", error.message);
      return res.status(500).json({ error: "Could not create account." });
    }

    const token = makeToken(user.id, user.username);
    res.json({ token, user: { id: user.id, username: user.username, createdAt: user.created_at } });
  };

  // POST /auth/login
  routes.login = async (req, res) => {
    const username = String(req.body.username || "").trim().toLowerCase();
    const password = String(req.body.password || "");

    if (!username || !password)
      return res.status(400).json({ error: "Username and password are required." });

    if (!supabase) return res.status(503).json({ error: "Database not configured." });

    const { data: user, error } = await findUserByUsername(supabase, username);

    if (error || !user) return res.status(401).json({ error: "Invalid username or password." });

    const valid = await verifyPassword(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: "Invalid username or password." });

    const token = makeToken(user.id, user.username);
    res.json({ token, user: { id: user.id, username: user.username, createdAt: user.created_at } });
  };

  // GET /auth/me 
  routes.me = (req, res) => {
    if (!req.user) return res.status(401).json({ error: "Not authenticated." });
    res.json({ user: req.user });
  };

  return routes;
}
