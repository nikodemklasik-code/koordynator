import { mkdir, open, readFile, unlink } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { canonicalDigest } from "../crypto/canonical-digest.js";
import type { CorporateEvent, CorporationSnapshot } from "./domain.js";
import type {
  CorporateEventStore,
  CorporationStateStore,
  CorporationTransactionStore
} from "./ports.js";

type JournalRecordBase = {
  txId: string;
  sequence: number;
  previousDigest: string | null;
  expectedRevision: number;
  snapshot: CorporationSnapshot;
  events: CorporateEvent[];
  committedAt: string;
};

type JournalRecord = JournalRecordBase & {
  recordDigest: string;
};

function recordDigest(base: JournalRecordBase): string {
  return canonicalDigest(base);
}

export class JournalCorporationStore
implements CorporationStateStore, CorporateEventStore, CorporationTransactionStore {
  private readonly ledgerPath: string;
  private readonly lockPath: string;

  constructor(stateDir: string) {
    const dir = join(resolve(stateDir), "corporation-v2");
    this.ledgerPath = join(dir, "ledger.jsonl");
    this.lockPath = join(dir, "ledger.lock");
  }

  async load(): Promise<CorporationSnapshot | null> {
    const records = await this.readValidRecords();
    return records.length ? structuredClone(records[records.length - 1]!.snapshot) : null;
  }

  async list(limit = 200): Promise<CorporateEvent[]> {
    const records = await this.readValidRecords();
    return records
      .flatMap((record) => record.events)
      .slice(-Math.max(1, Math.min(5000, Math.floor(limit))))
      .map((event) => structuredClone(event));
  }

  async save(): Promise<void> {
    throw new Error("JOURNAL_ATOMIC_COMMIT_REQUIRED");
  }

  async append(): Promise<void> {
    throw new Error("JOURNAL_ATOMIC_COMMIT_REQUIRED");
  }

  async commit(input: {
    expectedRevision: number;
    snapshot: CorporationSnapshot;
    events: CorporateEvent[];
  }): Promise<void> {
    await mkdir(dirname(this.ledgerPath), { recursive: true, mode: 0o700 });

    let lock: Awaited<ReturnType<typeof open>> | undefined;
    try {
      lock = await open(this.lockPath, "wx", 0o600);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") {
        throw new Error("CORPORATION_LEDGER_LOCKED");
      }
      throw error;
    }

    try {
      const records = await this.readValidRecords();
      const previous = records[records.length - 1];
      const currentRevision = previous?.snapshot.revision ?? 0;

      if (currentRevision !== input.expectedRevision) {
        throw new Error(
          `CORPORATION_REVISION_CONFLICT:expected=${input.expectedRevision}:actual=${currentRevision}`
        );
      }
      if (input.snapshot.revision !== input.expectedRevision + 1) {
        throw new Error("CORPORATION_NEXT_REVISION_INVALID");
      }

      const base: JournalRecordBase = {
        txId: `TX-${input.snapshot.revision}-${Date.now()}`,
        sequence: (previous?.sequence ?? 0) + 1,
        previousDigest: previous?.recordDigest ?? null,
        expectedRevision: input.expectedRevision,
        snapshot: structuredClone(input.snapshot),
        events: structuredClone(input.events),
        committedAt: new Date().toISOString()
      };
      const record: JournalRecord = {
        ...base,
        recordDigest: recordDigest(base)
      };

      const handle = await open(this.ledgerPath, "a", 0o600);
      try {
        await handle.writeFile(`${JSON.stringify(record)}\n`, "utf8");
        await handle.sync();
      } finally {
        await handle.close();
      }
    } finally {
      await lock.close().catch(() => undefined);
      await unlink(this.lockPath).catch(() => undefined);
    }
  }

  private async readValidRecords(): Promise<JournalRecord[]> {
    let text: string;
    try {
      text = await readFile(this.ledgerPath, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }

    const records: JournalRecord[] = [];
    const lines = text.split("\n").filter(Boolean);
    let previousDigest: string | null = null;
    let expectedSequence = 1;

    for (let index = 0; index < lines.length; index += 1) {
      let record: JournalRecord;
      try {
        record = JSON.parse(lines[index]!) as JournalRecord;
      } catch {
        if (index === lines.length - 1) break;
        throw new Error(`CORPORATION_LEDGER_CORRUPT_JSON:${index + 1}`);
      }

      const { recordDigest: storedDigest, ...base } = record;
      if (storedDigest !== recordDigest(base)) {
        throw new Error(`CORPORATION_LEDGER_DIGEST_MISMATCH:${index + 1}`);
      }
      if (record.sequence !== expectedSequence) {
        throw new Error(`CORPORATION_LEDGER_SEQUENCE_MISMATCH:${index + 1}`);
      }
      if (record.previousDigest !== previousDigest) {
        throw new Error(`CORPORATION_LEDGER_CHAIN_MISMATCH:${index + 1}`);
      }
      if (record.snapshot.revision !== record.expectedRevision + 1) {
        throw new Error(`CORPORATION_LEDGER_REVISION_MISMATCH:${index + 1}`);
      }

      records.push(record);
      previousDigest = storedDigest;
      expectedSequence += 1;
    }

    return records;
  }
}
