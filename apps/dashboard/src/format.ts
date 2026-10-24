export const EXPLORER_BASE = "https://sepolia.basescan.org";

export function explorerAddressUrl(address: string | null | undefined): string | null {
  if (typeof address !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(address)) return null;
  return `${EXPLORER_BASE}/address/${address}`;
}

export function explorerTxUrl(hash: string | null | undefined): string | null {
  if (typeof hash !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(hash)) return null;
  return `${EXPLORER_BASE}/tx/${hash}`;
}

export function formatTimestamp(seconds: number | null | undefined): string {
  if (typeof seconds !== "number" || !Number.isFinite(seconds)) return "—";
  const date = new Date(seconds * 1000);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function timeAgo(seconds: number | null | undefined): string {
  if (typeof seconds !== "number" || !Number.isFinite(seconds)) return "—";
  const delta = Math.floor(Date.now() / 1000) - seconds;
  if (delta < 0) return "just now";
  if (delta < 60) return `${delta}s ago`;
  if (delta < 3600) return `${Math.floor(delta / 60)}m ago`;
  if (delta < 86400) return `${Math.floor(delta / 3600)}h ago`;
  return `${Math.floor(delta / 86400)}d ago`;
}

export function formatIso(iso: string | null | undefined): string {
  if (typeof iso !== "string" || iso.length === 0) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return formatTimestamp(date.getTime() / 1000);
}

export function bytesToHexUtf8(text: string): string {
  return `0x${Array.from(new TextEncoder().encode(text), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

export function randomHexCredential(bytes = 32): string {
  const buffer = new Uint8Array(bytes);
  crypto.getRandomValues(buffer);
  return Array.from(buffer, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function truncateMiddle(value: string | null | undefined, head = 8, tail = 6): string {
  if (typeof value !== "string" || value.length === 0) return "—";
  if (value.length <= head + tail + 2) return value;
  return `${value.slice(0, head)}…${value.slice(-tail)}`;
}
