import { createClient } from "@libsql/client";
import { readFile } from "node:fs/promises";

const url = process.env.TURSO_DATABASE_URL;
const authToken = process.env.TURSO_AUTH_TOKEN;
if (!url || !authToken) throw new Error("Set TURSO_DATABASE_URL and TURSO_AUTH_TOKEN before migration");

const client = createClient({ url, authToken });
try {
  const sql = await readFile(new URL("../migrations/0001_initial.sql", import.meta.url), "utf8");
  await client.executeMultiple(sql);
  console.log("Aegis Turso schema applied");
} finally {
  client.close();
}
