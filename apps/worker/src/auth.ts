import { createClient, type Client, type ResultSet } from "@libsql/client/web";
import type { AuthenticatedUser, Env } from "./env.js";

const PASSWORD_ITERATIONS = 120_000;
const SESSION_LIFETIME_SECONDS = 7 * 24 * 60 * 60;
const encoder = new TextEncoder();

export class AuthError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

export interface AuthSession {
  user: AuthenticatedUser;
  csrfHash: string;
  expiresAt: number;
}

export function getDatabase(env: Pick<Env, "TURSO_DATABASE_URL" | "TURSO_AUTH_TOKEN">): Client {
  if (!env.TURSO_DATABASE_URL || !env.TURSO_AUTH_TOKEN) throw new AuthError(503, "DATABASE_NOT_CONFIGURED");
  return createClient({ url: env.TURSO_DATABASE_URL, authToken: env.TURSO_AUTH_TOKEN });
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function hexToBytes(value: string): Uint8Array {
  const bytes = new Uint8Array(value.length / 2);
  for (let i = 0; i < bytes.length; i += 1) bytes[i] = Number.parseInt(value.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

function randomHex(length: number): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytesToHex(bytes);
}

async function sha256Hex(value: string): Promise<string> {
  return bytesToHex(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value))));
}

export async function hashOpaqueToken(value: string): Promise<string> {
  return sha256Hex(value);
}

export async function hashAgentCredential(env: Pick<Env, "AGENT_TOKEN_PEPPER">, value: string): Promise<string> {
  const pepper = env.AGENT_TOKEN_PEPPER;
  if (!pepper || pepper.length < 32) throw new AuthError(503, "AGENT_TOKEN_PEPPER_NOT_CONFIGURED");
  const key = await crypto.subtle.importKey("raw", encoder.encode(pepper), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(value));
  return bytesToHex(new Uint8Array(signature));
}

export interface AuthenticatedAgent {
  id: string;
  walletId: string;
  userId: string;
  ownerAddress: string;
  sessionKeyAddress: string;
  status: "active" | "revoked" | "dead";
  name: string;
  chainId: number;
  accountAddress: string;
}

export async function requireAgent(
  env: Env,
  request: Request,
): Promise<AuthenticatedAgent> {
  const header = request.headers.get("Authorization");
  const token = header?.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (token.length < 40 || token.length > 256) throw new AuthError(401, "AGENT_AUTH_REQUIRED");
  const tokenHash = await hashAgentCredential(env, token);
  const db = getDatabase(env);
  try {
    const result = await db.execute({
      sql: `SELECT a.id, a.wallet_id AS walletId, w.user_id AS userId, w.owner_address AS ownerAddress,
                   a.session_key_address AS sessionKeyAddress, a.status, a.name,
                   w.chain_id AS chainId, w.address AS accountAddress
            FROM agents a JOIN wallets w ON w.id = a.wallet_id
            WHERE a.token_hash = ? LIMIT 1`,
      args: [tokenHash],
    });
    const row = result.rows[0] as unknown as AuthenticatedAgent | undefined;
    if (!row || row.status !== "active") throw new AuthError(401, "AGENT_REVOKED_OR_UNKNOWN");
    return row;
  } finally {
    db.close();
  }
}

async function hashPassword(password: string, saltHex: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({
    name: "PBKDF2",
    hash: "SHA-256",
    salt: new Uint8Array(hexToBytes(saltHex)).buffer,
    iterations: PASSWORD_ITERATIONS,
  }, key, 256);
  return bytesToHex(new Uint8Array(bits));
}

function constantTimeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let i = 0; i < left.length; i += 1) difference |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return difference === 0;
}

export async function registerUser(
  env: Env,
  emailInput: string,
  password: string,
): Promise<{ id: string; email: string }> {
  if (password.length < 12 || password.length > 256) throw new AuthError(400, "PASSWORD_LENGTH_INVALID");
  const email = emailInput.trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new AuthError(400, "EMAIL_INVALID");
  const db = getDatabase(env);
  const id = crypto.randomUUID();
  const salt = randomHex(16);
  const passwordHash = await hashPassword(password, salt);
  try {
    await db.execute({
      sql: "INSERT INTO users (id, email, password_hash, salt, created_at) VALUES (?, ?, ?, ?, ?)",
      args: [id, email, passwordHash, salt, Math.floor(Date.now() / 1_000)],
    });
  } catch {
    throw new AuthError(409, "EMAIL_ALREADY_REGISTERED");
  } finally {
    db.close();
  }
  return { id, email };
}

export async function loginUser(
  env: Env,
  emailInput: string,
  password: string,
): Promise<{ user: { id: string; email: string }; cookies: [string, string]; csrfToken: string; expiresAt: number }> {
  const email = emailInput.trim().toLowerCase();
  const db = getDatabase(env);
  let row: { id: string; email: string; password_hash: string; salt: string } | undefined;
  try {
    const result = await db.execute({ sql: "SELECT id, email, password_hash, salt FROM users WHERE email = ? LIMIT 1", args: [email] });
    row = result.rows[0] as unknown as typeof row;
  } finally {
    db.close();
  }
  if (!row) throw new AuthError(401, "INVALID_CREDENTIALS");
  const candidateHash = await hashPassword(password, row.salt);
  if (!constantTimeEqual(candidateHash, row.password_hash)) throw new AuthError(401, "INVALID_CREDENTIALS");

  const sessionId = crypto.randomUUID();
  const sessionToken = randomHex(32);
  const csrfToken = randomHex(32);
  const tokenHash = await sha256Hex(sessionToken);
  const csrfHash = await sha256Hex(csrfToken);
  const createdAt = Math.floor(Date.now() / 1_000);
  const expiresAt = createdAt + SESSION_LIFETIME_SECONDS;
  const db2 = getDatabase(env);
  try {
    await db2.execute({
      sql: "INSERT INTO sessions (id, user_id, token_hash, csrf_hash, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)",
      args: [sessionId, row.id, tokenHash, csrfHash, createdAt, expiresAt],
    });
  } finally {
    db2.close();
  }
  const maxAge = SESSION_LIFETIME_SECONDS;
  const sessionCookie = `__Host-aegis_session=${sessionToken}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
  const csrfCookie = `aegis_csrf=${csrfToken}; Path=/; Secure; SameSite=Lax; Max-Age=${maxAge}`;
  return { user: { id: row.id, email: row.email }, cookies: [sessionCookie, csrfCookie], csrfToken, expiresAt };
}

function cookieValue(cookieHeader: string | null, name: string): string | undefined {
  if (!cookieHeader) return undefined;
  for (const part of cookieHeader.split(";")) {
    const [key, ...values] = part.trim().split("=");
    if (key === name) return values.join("=");
  }
  return undefined;
}

export async function requireSession(env: Env, request: Request, requireCsrf: boolean): Promise<AuthSession> {
  const sessionToken = cookieValue(request.headers.get("Cookie"), "__Host-aegis_session");
  if (!sessionToken) throw new AuthError(401, "AUTH_REQUIRED");
  const tokenHash = await sha256Hex(sessionToken);
  const db = getDatabase(env);
  let row: {
    session_id: string;
    user_id: string;
    email: string;
    csrf_hash: string;
    expires_at: number;
    revoked_at: number | null;
  } | undefined;
  try {
    const result: ResultSet = await db.execute({
      sql: `SELECT s.id AS session_id, s.user_id, u.email, s.csrf_hash, s.expires_at, s.revoked_at
            FROM sessions s JOIN users u ON u.id = s.user_id
            WHERE s.token_hash = ? LIMIT 1`,
      args: [tokenHash],
    });
    row = result.rows[0] as unknown as typeof row;
  } finally {
    db.close();
  }
  const now = Math.floor(Date.now() / 1_000);
  if (!row || row.revoked_at !== null || row.expires_at <= now) throw new AuthError(401, "SESSION_INVALID_OR_EXPIRED");
  if (requireCsrf) {
    const csrfCookie = cookieValue(request.headers.get("Cookie"), "aegis_csrf");
    const csrfHeader = request.headers.get("X-CSRF-Token");
    if (!csrfCookie || !csrfHeader || !constantTimeEqual(csrfCookie, csrfHeader)) throw new AuthError(403, "CSRF_INVALID");
    if (!constantTimeEqual(await sha256Hex(csrfHeader), row.csrf_hash)) throw new AuthError(403, "CSRF_INVALID");
  }
  return {
    user: { id: row.user_id, email: row.email, sessionId: row.session_id },
    csrfHash: row.csrf_hash,
    expiresAt: row.expires_at,
  };
}

export async function logoutSession(env: Env, sessionId: string): Promise<void> {
  const db = getDatabase(env);
  try {
    await db.execute({ sql: "UPDATE sessions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL", args: [Math.floor(Date.now() / 1_000), sessionId] });
  } finally {
    db.close();
  }
}

export const clearSessionCookies = [
  "__Host-aegis_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0",
  "aegis_csrf=; Path=/; Secure; SameSite=Lax; Max-Age=0",
] as const;
