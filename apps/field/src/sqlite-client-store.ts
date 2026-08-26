import * as SQLite from "expo-sqlite";

import { receiptDtoSchema, receiptOpSchema } from "@saddlebag/contracts";
import {
  hlcFromString,
  hlcToString,
  type Hlc,
  type ImageMediaType,
  type ReceiptOp,
  type ReceiptProps,
} from "@saddlebag/domain";
import {
  opFromDto,
  opToDto,
  receiptFromDto,
  receiptToDto,
  type PendingImage,
  type SyncClientStore,
} from "@saddlebag/sync";

const MEDIA_TYPES: ImageMediaType[] = ["image/jpeg", "image/png", "image/webp", "image/gif"];

/**
 * The saddlebag itself: everything the phone knows, in one on-device SQLite
 * file. Rows are the same wire DTOs the sync protocol speaks, so a receipt
 * survives an app restart in a dead zone exactly as it will later go over
 * the air.
 */
export class SqliteClientStore implements SyncClientStore {
  private constructor(private readonly db: SQLite.SQLiteDatabase) {}

  static async open(name: string): Promise<SqliteClientStore> {
    const db = await SQLite.openDatabaseAsync(name);
    await db.execAsync(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS server_receipts (id TEXT PRIMARY KEY, json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS outbox (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        op_id TEXT UNIQUE NOT NULL,
        json TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS pending_images (
        ref TEXT PRIMARY KEY,
        base64 TEXT NOT NULL,
        media_type TEXT NOT NULL
      );
    `);
    return new SqliteClientStore(db);
  }

  // -- app shell settings (device id, barn url) share the meta table --

  async loadSetting(key: string): Promise<string | null> {
    return this.metaGet(`setting:${key}`);
  }

  async saveSetting(key: string, value: string): Promise<void> {
    await this.metaSet(`setting:${key}`, value);
  }

  // -- SyncClientStore --

  async loadHlc(): Promise<Hlc | null> {
    const value = await this.metaGet("hlc");
    return value === null ? null : hlcFromString(value);
  }

  async saveHlc(hlc: Hlc): Promise<void> {
    await this.metaSet("hlc", hlcToString(hlc));
  }

  async loadCursor(): Promise<number> {
    const value = await this.metaGet("cursor");
    return value === null ? 0 : Number(value);
  }

  async saveCursor(cursor: number): Promise<void> {
    await this.metaSet("cursor", String(cursor));
  }

  async getServerReceipt(id: string): Promise<ReceiptProps | null> {
    const row = await this.db.getFirstAsync<{ json: string }>(
      "SELECT json FROM server_receipts WHERE id = ?",
      [id],
    );
    return row == null ? null : parseReceipt(row.json);
  }

  async upsertServerReceipt(props: ReceiptProps): Promise<void> {
    await this.db.runAsync(
      `INSERT INTO server_receipts (id, json) VALUES (?, ?)
       ON CONFLICT(id) DO UPDATE SET json = excluded.json`,
      [props.id, JSON.stringify(receiptToDto(props))],
    );
  }

  async listServerReceipts(): Promise<ReceiptProps[]> {
    const rows = await this.db.getAllAsync<{ json: string }>("SELECT json FROM server_receipts");
    return rows.map((row) => parseReceipt(row.json));
  }

  async enqueueOp(op: ReceiptOp): Promise<void> {
    await this.db.runAsync("INSERT INTO outbox (op_id, json) VALUES (?, ?)", [
      op.opId,
      JSON.stringify(opToDto(op)),
    ]);
  }

  async pendingOps(): Promise<ReceiptOp[]> {
    const rows = await this.db.getAllAsync<{ json: string }>(
      "SELECT json FROM outbox ORDER BY seq ASC",
    );
    return rows.map((row) => opFromDto(receiptOpSchema.parse(JSON.parse(row.json))));
  }

  async removeOps(opIds: readonly string[]): Promise<void> {
    if (opIds.length === 0) return;
    const placeholders = opIds.map(() => "?").join(", ");
    await this.db.runAsync(`DELETE FROM outbox WHERE op_id IN (${placeholders})`, [...opIds]);
  }

  async enqueueImage(image: PendingImage): Promise<void> {
    await this.db.runAsync(
      `INSERT INTO pending_images (ref, base64, media_type) VALUES (?, ?, ?)
       ON CONFLICT(ref) DO UPDATE SET base64 = excluded.base64, media_type = excluded.media_type`,
      [image.ref, image.base64, image.mediaType],
    );
  }

  async pendingImages(): Promise<PendingImage[]> {
    const rows = await this.db.getAllAsync<{ ref: string; base64: string; media_type: string }>(
      "SELECT ref, base64, media_type FROM pending_images",
    );
    return rows.map((row) => ({
      ref: row.ref,
      base64: row.base64,
      mediaType: MEDIA_TYPES.includes(row.media_type as ImageMediaType)
        ? (row.media_type as ImageMediaType)
        : "image/jpeg",
    }));
  }

  async removeImage(ref: string): Promise<void> {
    await this.db.runAsync("DELETE FROM pending_images WHERE ref = ?", [ref]);
  }

  private async metaGet(key: string): Promise<string | null> {
    const row = await this.db.getFirstAsync<{ value: string }>(
      "SELECT value FROM meta WHERE key = ?",
      [key],
    );
    return row == null ? null : row.value;
  }

  private async metaSet(key: string, value: string): Promise<void> {
    await this.db.runAsync(
      "INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      [key, value],
    );
  }
}

function parseReceipt(json: string): ReceiptProps {
  return receiptFromDto(receiptDtoSchema.parse(JSON.parse(json)));
}
