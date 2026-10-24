export type JsonRecord = Record<string, unknown>;

const configuredBase = import.meta.env.VITE_API_BASE_URL?.trim().replace(/\/+$/, "");
const apiBase = configuredBase
  ? `${configuredBase.endsWith("/api") ? configuredBase : `${configuredBase}/api`}`
  : "/api";

let csrfFromLogin = "";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly payload?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

function readCsrfCookie(): string {
  if (typeof document === "undefined") return csrfFromLogin;
  const item = document.cookie.split(";").map((part) => part.trim()).find((part) => part.startsWith("aegis_csrf="));
  if (item) return decodeURIComponent(item.slice("aegis_csrf=".length));
  return csrfFromLogin;
}

export function rememberCsrfToken(token: string): void {
  csrfFromLogin = token;
}

export async function apiRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  if (options.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  if (options.method && !["GET", "HEAD"].includes(options.method.toUpperCase())) {
    const csrfToken = readCsrfCookie();
    if (csrfToken && !headers.has("X-CSRF-Token")) headers.set("X-CSRF-Token", csrfToken);
  }

  let response: Response;
  try {
    response = await fetch(`${apiBase}${path.startsWith("/") ? path : `/${path}`}`, {
      ...options,
      headers,
      credentials: "include",
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Network request failed";
    throw new ApiError(`API is unreachable or not configured (${detail})`, 0);
  }

  const contentType = response.headers.get("content-type") ?? "";
  let payload: unknown;
  if (contentType.includes("application/json")) {
    payload = await response.json().catch(() => undefined);
  } else {
    payload = await response.text().catch(() => "");
  }

  if (!response.ok) {
    const body = payload && typeof payload === "object" ? payload as JsonRecord : undefined;
    const message = typeof body?.error === "string"
      ? body.error
      : `Request failed with HTTP ${response.status}`;
    throw new ApiError(message, response.status, payload);
  }

  return payload as T;
}

export function isApiNotConfigured(error: unknown): boolean {
  return error instanceof ApiError && (error.status === 0 || error.status === 404);
}

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return "An unexpected error occurred.";
}

export function formatAtomic(value: string | number | null | undefined, decimals = 6, maximumFractionDigits = 6): string {
  if (value === null || value === undefined || value === "") return "Not available";
  try {
    const atomic = BigInt(value);
    const base = 10n ** BigInt(decimals);
    const whole = atomic / base;
    const fractional = (atomic % base).toString().padStart(decimals, "0").slice(0, maximumFractionDigits).replace(/0+$/, "");
    return fractional ? `${whole.toLocaleString()}.${fractional}` : whole.toLocaleString();
  } catch {
    return String(value);
  }
}

export function parseUnits(value: string, decimals = 6, allowZero = false): string {
  const trimmed = value.trim();
  if (!/^\d+(?:\.\d*)?$/.test(trimmed)) throw new Error("Enter a positive amount using digits and an optional decimal point.");
  const [wholePart, fractionalPart = ""] = trimmed.split(".");
  if (fractionalPart.length > decimals) throw new Error(`Use no more than ${decimals} decimal places.`);
  const atomic = BigInt(wholePart || "0") * (10n ** BigInt(decimals)) + BigInt(fractionalPart.padEnd(decimals, "0") || "0");
  if (atomic < (allowZero ? 0n : 1n)) throw new Error("Amount must be greater than zero.");
  return atomic.toString();
}

export function shortAddress(value: unknown): string {
  if (typeof value !== "string") return "—";
  if (value.length <= 16) return value;
  return `${value.slice(0, 8)}…${value.slice(-6)}`;
}

export function prettyJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}
