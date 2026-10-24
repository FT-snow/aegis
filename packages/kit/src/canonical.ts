import { keccak256, toBytes } from "viem";

/** Canonical JSON for the JSON-only Aegis wire format (sorted keys, no undefined/BigInt). */
export function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("Canonical JSON cannot contain a non-finite number");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object") {
    const object = value as Record<string, unknown>;
    const keys = Object.keys(object).sort();
    const entries = keys.map((key) => {
      const item = object[key];
      if (item === undefined) throw new TypeError(`Canonical JSON cannot contain undefined at ${key}`);
      return `${JSON.stringify(key)}:${canonicalJson(item)}`;
    });
    return `{${entries.join(",")}}`;
  }
  throw new TypeError(`Canonical JSON cannot contain ${typeof value}`);
}

export function hashJson(value: unknown): `0x${string}` {
  return keccak256(toBytes(canonicalJson(value)));
}

export function hashText(value: string): `0x${string}` {
  return keccak256(toBytes(value));
}
