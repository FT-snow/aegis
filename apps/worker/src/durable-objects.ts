import { createPassport, PassportInputSchema, verifyPassport, type DecisionPassport } from "@aegis/kit";
import { runSimulation, type SimulationConfig, type SimulationResult } from "@aegis/sim-core";
import type { Env } from "./env.js";

interface StoredPassportRow {
  [key: string]: string | number | null;
  sequence: number;
  passport_hash: string;
  previous_hash: string | null;
  payload_json: string;
}

export class PassportLedger {
  constructor(private readonly state: DurableObjectState, _env: Env) {
    this.state.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS passports (
        sequence INTEGER PRIMARY KEY,
        passport_hash TEXT NOT NULL UNIQUE,
        previous_hash TEXT,
        payload_json TEXT NOT NULL
      )
    `);
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "POST" && url.pathname === "/append") {
      const input = PassportInputSchema.safeParse(await request.json());
      if (!input.success) return Response.json({ error: "INVALID_PASSPORT_INPUT", issues: input.error.issues }, { status: 400 });
      const latest = this.state.storage.sql
        .exec<StoredPassportRow>("SELECT sequence, passport_hash, previous_hash, payload_json FROM passports ORDER BY sequence DESC LIMIT 1")
        .toArray()[0];
      const passport = createPassport(input.data, {
        sequence: (latest?.sequence ?? 0) + 1,
        previousHash: (latest?.passport_hash as `0x${string}` | undefined) ?? null,
      });
      this.state.storage.sql.exec(
        "INSERT INTO passports (sequence, passport_hash, previous_hash, payload_json) VALUES (?, ?, ?, ?)",
        passport.sequence,
        passport.passportHash,
        passport.previousHash,
        JSON.stringify(passport),
      );
      return Response.json(passport, { status: 201 });
    }

    if (request.method === "GET" && url.pathname === "/head") {
      const latest = this.state.storage.sql
        .exec<StoredPassportRow>("SELECT sequence, passport_hash FROM passports ORDER BY sequence DESC LIMIT 1")
        .toArray()[0];
      return Response.json({ sequence: latest?.sequence ?? 0, hash: latest?.passport_hash ?? null });
    }

    if (request.method === "GET" && url.pathname.startsWith("/passport/")) {
      const hash = decodeURIComponent(url.pathname.slice("/passport/".length));
      const row = this.state.storage.sql
        .exec<StoredPassportRow>("SELECT sequence, passport_hash, previous_hash, payload_json FROM passports WHERE passport_hash = ?", hash)
        .toArray()[0];
      if (!row) return Response.json({ error: "PASSPORT_NOT_FOUND" }, { status: 404 });
      return Response.json(JSON.parse(row.payload_json) as DecisionPassport);
    }

    if (request.method === "GET" && url.pathname.startsWith("/verify/")) {
      const hash = decodeURIComponent(url.pathname.slice("/verify/".length));
      const target = this.state.storage.sql
        .exec<StoredPassportRow>("SELECT sequence, passport_hash, previous_hash, payload_json FROM passports WHERE passport_hash = ?", hash)
        .toArray()[0];
      if (!target) return Response.json({ error: "PASSPORT_NOT_FOUND" }, { status: 404 });
      const rows = this.state.storage.sql
        .exec<StoredPassportRow>(
          "SELECT sequence, passport_hash, previous_hash, payload_json FROM passports WHERE sequence <= ? ORDER BY sequence ASC",
          target.sequence,
        )
        .toArray();
      let previousHash: `0x${string}` | null = null;
      for (const row of rows) {
        const result = verifyPassport(JSON.parse(row.payload_json), previousHash);
        if (!result.valid) {
          return Response.json({ ...result, verifiedThrough: row.sequence - 1, head: await this.head() }, { status: 409 });
        }
        previousHash = row.passport_hash as `0x${string}`;
      }
      const valid = previousHash === hash && rows.length === target.sequence;
      return Response.json({
        valid,
        verifiedThrough: valid ? rows.length : 0,
        head: await this.head(),
        errors: valid ? [] : ["journal sequence or hash continuity failed"],
      }, { status: valid ? 200 : 409 });
    }

    return Response.json({ error: "NOT_FOUND" }, { status: 404 });
  }

  private async head() {
    const latest = this.state.storage.sql
      .exec<StoredPassportRow>("SELECT sequence, passport_hash FROM passports ORDER BY sequence DESC LIMIT 1")
      .toArray()[0];
    return { sequence: latest?.sequence ?? 0, hash: latest?.passport_hash ?? null };
  }
}

export class SimulationRunStore {
  private readonly archive: R2Bucket | undefined;

  constructor(private readonly state: DurableObjectState, env: Env) {
    this.archive = env.SIM_ARCHIVE;
  }

  private archiveKey(): string {
    return `simulation-runs/${this.state.id.toString()}.json`;
  }

  private async readVerifiedArchive(): Promise<SimulationResult | undefined> {
    if (!this.archive) return undefined;
    const stored = await this.archive.get(this.archiveKey());
    if (!stored) return undefined;
    const archived = JSON.parse(await stored.text()) as SimulationResult;
    const replayed = runSimulation(archived.config);
    if (
      replayed.summary.eventHash !== archived.summary.eventHash ||
      replayed.summary.passportHead !== archived.summary.passportHead
    ) {
      throw new Error("SIMULATION_ARCHIVE_INTEGRITY_FAILURE");
    }
    return replayed;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "POST" && url.pathname === "/") {
      try {
        const body = await request.json<SimulationConfig>();
        const result: SimulationResult = runSimulation(body);
        await this.state.storage.put("result", result);
        let archived = false;
        if (this.archive) {
          try {
            await this.archive.put(this.archiveKey(), JSON.stringify(result), {
              httpMetadata: { contentType: "application/json; charset=utf-8" },
              customMetadata: {
                eventHash: result.summary.eventHash,
                passportHead: result.summary.passportHead ?? "",
                seed: String(result.summary.seed),
              },
            });
            archived = true;
          } catch {
            // The Durable Object remains the primary store; archive failure is exposed.
          }
        }
        return Response.json({
          id: this.state.id.toString(),
          summary: result.summary,
          archive: archived ? { status: "stored", key: this.archiveKey() } : { status: this.archive ? "write_failed" : "not_configured" },
        }, { status: 201 });
      } catch (error) {
        return Response.json({ error: error instanceof Error ? error.message : "INVALID_SIMULATION" }, { status: 400 });
      }
    }
    if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/export")) {
      try {
        let result = await this.state.storage.get<SimulationResult>("result");
        if (!result) {
          result = await this.readVerifiedArchive();
          if (result) await this.state.storage.put("result", result);
        }
        if (!result) return Response.json({ error: "SIMULATION_NOT_FOUND" }, { status: 404 });
        if (url.pathname === "/export") {
          return new Response(JSON.stringify(result, null, 2), {
            headers: {
              "Content-Type": "application/json; charset=utf-8",
              "Content-Disposition": `attachment; filename="aegis-simulation-${this.state.id.toString()}.json"`,
            },
          });
        }
        return Response.json(result);
      } catch (error) {
        return Response.json({ error: error instanceof Error ? error.message : "SIMULATION_ARCHIVE_READ_FAILED" }, { status: 409 });
      }
    }
    return Response.json({ error: "NOT_FOUND" }, { status: 404 });
  }
}

export class WalletRoom {
  private static readonly BUFFER_SIZE = 200;

  constructor(private readonly state: DurableObjectState, private readonly env: Env) {}

  private async currentSeq(): Promise<number> {
    return Number((await this.state.storage.get<number>("seq")) ?? 0);
  }

  private async broadcastEntry(type: string, payload: unknown): Promise<number> {
    const seq = (await this.currentSeq()) + 1;
    const message = { seq, type, payload };
    await this.state.storage.put("seq", seq);
    await this.state.storage.put(`msg:${seq}`, message);
    if (seq > WalletRoom.BUFFER_SIZE) {
      await this.state.storage.delete(`msg:${seq - WalletRoom.BUFFER_SIZE}`);
    }
    for (const socket of this.state.getWebSockets()) {
      try {
        socket.send(JSON.stringify(message));
      } catch {
        // Hibernation API removes dead sockets automatically.
      }
    }
    return seq;
  }

  private async missedAfter(after: number): Promise<unknown[]> {
    const seq = await this.currentSeq();
    const out: unknown[] = [];
    const start = Math.max(1, after + 1);
    for (let s = start; s <= Math.min(seq, start + WalletRoom.BUFFER_SIZE); s += 1) {
      const message = await this.state.storage.get(`msg:${s}`);
      if (message) out.push(message);
    }
    return out;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/connect" && request.headers.get("Upgrade") === "websocket") {
      const pair = new WebSocketPair();
      this.state.acceptWebSocket(pair[1]);
      const after = Number(url.searchParams.get("after") ?? "0");
      const missed = await this.missedAfter(Number.isSafeInteger(after) ? after : 0);
      for (const message of missed) {
        try {
          pair[1].send(JSON.stringify(message));
        } catch {
          // Client disconnected mid catch-up; it can reconnect with lastSeq.
        }
      }
      pair[1].send(JSON.stringify({ seq: await this.currentSeq(), type: "indexer_status", payload: { connected: true } }));
      return new Response(null, { status: 101, webSocket: pair[0] });
    }
    if (request.method === "POST" && url.pathname === "/broadcast") {
      const body = await request.json<{ type?: unknown; payload?: unknown }>().catch(() => null);
      if (!body || typeof body.type !== "string" || body.type.length === 0) {
        return Response.json({ error: "INVALID_BROADCAST" }, { status: 400 });
      }
      const seq = await this.broadcastEntry(body.type, body.payload ?? null);
      return Response.json({ seq }, { status: 201 });
    }
    if (request.method === "GET" && url.pathname === "/missed") {
      const after = Number(url.searchParams.get("after") ?? "0");
      return Response.json({ seq: await this.currentSeq(), events: await this.missedAfter(Number.isSafeInteger(after) ? after : 0) });
    }
    return Response.json({ error: "NOT_FOUND" }, { status: 404 });
  }

  async webSocketMessage(_ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    try {
      const parsed = JSON.parse(String(message)) as { lastSeq?: unknown };
      const after = typeof parsed.lastSeq === "number" && Number.isSafeInteger(parsed.lastSeq) ? parsed.lastSeq : 0;
      for (const missed of await this.missedAfter(after)) {
        _ws.send(JSON.stringify(missed));
      }
    } catch {
      // Ignore malformed client messages.
    }
  }

  webSocketClose(_ws: WebSocket): void {
    // Hibernation API cleans up automatically.
  }
}

export class RateLimiter {
  constructor(private readonly state: DurableObjectState, _env: Env) {
    this.state.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS rate_window (
        window_start INTEGER NOT NULL,
        hits INTEGER NOT NULL
      )
    `);
  }

  async fetch(request: Request): Promise<Response> {
    const limit = Number(request.headers.get("x-limit") ?? "30");
    const windowSeconds = Number(request.headers.get("x-window-seconds") ?? "60");
    if (!Number.isInteger(limit) || limit < 1 || limit > 10_000 || !Number.isInteger(windowSeconds) || windowSeconds < 1) {
      return Response.json({ error: "INVALID_LIMIT" }, { status: 400 });
    }
    const now = Math.floor(Date.now() / 1000);
    const currentWindow = Math.floor(now / windowSeconds) * windowSeconds;
    const existing = this.state.storage.sql.exec<{ window_start: number; hits: number }>(
      "SELECT window_start, hits FROM rate_window LIMIT 1",
    ).toArray()[0];
    const hits = existing?.window_start === currentWindow ? existing.hits : 0;
    const allowed = hits < limit;
    const nextHits = allowed ? hits + 1 : hits;
    this.state.storage.sql.exec("DELETE FROM rate_window");
    this.state.storage.sql.exec("INSERT INTO rate_window (window_start, hits) VALUES (?, ?)", currentWindow, nextHits);
    return Response.json({ allowed, remaining: Math.max(0, limit - nextHits), resetAt: currentWindow + windowSeconds });
  }
}
