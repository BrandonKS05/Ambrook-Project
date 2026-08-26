import Database from "better-sqlite3";

import { receiptDtoSchema } from "@saddlebag/contracts";
import { Receipt, type ReceiptStore } from "@saddlebag/domain";
import { receiptFromDto, receiptToDto } from "@saddlebag/sync/codec";

/**
 * Receipts persist as their wire DTO (HLC stamps as sortable strings) — one
 * codec for the wire and the shelf, revalidated on the way out.
 */
export class SqliteReceiptStore implements ReceiptStore {
  private constructor(private readonly db: Database.Database) {}

  static open(path: string): SqliteReceiptStore {
    const db = new Database(path);
    db.pragma("journal_mode = WAL");
    db.exec(`
      CREATE TABLE IF NOT EXISTS receipts (
        id   TEXT PRIMARY KEY,
        seq  INTEGER NOT NULL,
        json TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS receipts_seq ON receipts(seq);
      CREATE TABLE IF NOT EXISTS applied_ops (op_id TEXT PRIMARY KEY);
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    `);
    return new SqliteReceiptStore(db);
  }

  async findById(id: string): Promise<Receipt | null> {
    const row = this.db.prepare("SELECT json FROM receipts WHERE id = ?").get(id) as
      | { json: string }
      | undefined;
    return row === undefined ? null : rehydrate(row.json);
  }

  async save(receipt: Receipt, seq: number): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO receipts (id, seq, json) VALUES (?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET seq = excluded.seq, json = excluded.json`,
      )
      .run(receipt.id, seq, JSON.stringify(receiptToDto(receipt.toProps())));
  }

  async nextSeq(): Promise<number> {
    const row = this.db
      .prepare(
        `INSERT INTO meta (key, value) VALUES ('seq', '1')
         ON CONFLICT(key) DO UPDATE SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT)
         RETURNING CAST(value AS INTEGER) AS seq`,
      )
      .get() as { seq: number };
    return row.seq;
  }

  async changedSince(cursor: number): Promise<{ receipts: Receipt[]; cursor: number }> {
    const rows = this.db
      .prepare("SELECT seq, json FROM receipts WHERE seq > ? ORDER BY seq ASC")
      .all(cursor) as Array<{ seq: number; json: string }>;
    return {
      receipts: rows.map((row) => rehydrate(row.json)),
      cursor: rows.length === 0 ? cursor : (rows[rows.length - 1]?.seq ?? cursor),
    };
  }

  async hasOp(opId: string): Promise<boolean> {
    return this.db.prepare("SELECT 1 FROM applied_ops WHERE op_id = ?").get(opId) !== undefined;
  }

  async recordOp(opId: string): Promise<void> {
    this.db.prepare("INSERT OR IGNORE INTO applied_ops (op_id) VALUES (?)").run(opId);
  }
}

function rehydrate(json: string): Receipt {
  return Receipt.reconstitute(receiptFromDto(receiptDtoSchema.parse(JSON.parse(json))));
}
