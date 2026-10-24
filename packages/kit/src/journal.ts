import { createPassport, verifyPassport } from "./passport.js";
import type { DecisionPassport, PassportInput, PassportOptions, PassportVerification } from "./index.js";

export interface JournalHead {
  sequence: number;
  hash: `0x${string}` | null;
}

export interface PassportJournal {
  append(input: PassportInput): Promise<DecisionPassport>;
  getByHash(hash: string): Promise<DecisionPassport | undefined>;
  head(): Promise<JournalHead>;
  verifyThrough(hash: string): Promise<PassportVerification & { verifiedThrough: number }>;
}

/** In-memory adapter for tests, local demonstrations, and deterministic simulation. */
export class MemoryPassportJournal implements PassportJournal {
  readonly #passports: DecisionPassport[] = [];
  readonly #byHash = new Map<string, DecisionPassport>();

  async append(input: PassportInput): Promise<DecisionPassport> {
    const previous = this.#passports.at(-1);
    const options: PassportOptions = {
      sequence: this.#passports.length + 1,
      previousHash: previous?.passportHash ?? null,
    };
    const passport = createPassport(input, options);
    this.#passports.push(passport);
    this.#byHash.set(passport.passportHash, passport);
    return passport;
  }

  async getByHash(hash: string): Promise<DecisionPassport | undefined> {
    return this.#byHash.get(hash);
  }

  async head(): Promise<JournalHead> {
    const last = this.#passports.at(-1);
    return { sequence: this.#passports.length, hash: last?.passportHash ?? null };
  }

  async verifyThrough(hash: string): Promise<PassportVerification & { verifiedThrough: number }> {
    const target = this.#byHash.get(hash);
    if (!target) {
      return {
        valid: false,
        checks: { schema: false, policyHash: false, replayedEvaluation: false, passportHash: false, previousHash: false },
        errors: ["passport not found"],
        verifiedThrough: 0,
      };
    }
    let previousHash: `0x${string}` | null = null;
    let verifiedThrough = 0;
    let failedVerification: PassportVerification | undefined;
    for (const passport of this.#passports.slice(0, target.sequence)) {
      const verification = verifyPassport(passport, previousHash);
      if (!verification.valid) {
        failedVerification = verification;
        break;
      }
      previousHash = passport.passportHash;
      verifiedThrough = passport.sequence;
    }
    if (failedVerification) return { ...failedVerification, verifiedThrough };
    const valid = verifiedThrough === target.sequence && previousHash === target.passportHash;
    return {
      valid,
      checks: {
        schema: valid,
        policyHash: valid,
        replayedEvaluation: valid,
        passportHash: valid,
        previousHash: valid,
      },
      errors: valid ? [] : ["journal continuity or target hash failed"],
      verifiedThrough,
    };
  }

  /** Test-only tamper hook to prove that the verifier detects changed storage. */
  tamper(hash: string, edit: (passport: DecisionPassport) => DecisionPassport): void {
    const existing = this.#byHash.get(hash);
    if (!existing) throw new Error("Unknown passport hash");
    const index = existing.sequence - 1;
    const changed = edit(existing);
    this.#passports[index] = changed;
    this.#byHash.delete(hash);
    this.#byHash.set(changed.passportHash, changed);
  }
}
