import { existsSync, readFileSync, writeFileSync } from "node:fs";

import { receiptDtoSchema, receiptOpSchema, type ReceiptDto, type ReceiptOpDto } from "@saddlebag/contracts";
import { hlcFromString, hlcToString, type Hlc, type ReceiptOp, type ReceiptProps } from "@saddlebag/domain";
import {
  opFromDto,
  opToDto,
  receiptFromDto,
  receiptToDto,
  type PendingImage,
  type SyncClientStore,
} from "@saddlebag/sync";

interface PersistedState {
  deviceId: string;
  barnUrl: string | null;
  hlc: string | null;
  cursor: number;
  server: ReceiptDto[];
  ops: ReceiptOpDto[];
  images: PendingImage[];
}

function freshState(): PersistedState {
  return {
    deviceId: `phone-${Math.random().toString(36).slice(2, 6)}`,
    barnUrl: null,
    hlc: null,
    cursor: 0,
    server: [],
    ops: [],
    images: [],
  };
}

/**
 * The saddlebag as one JSON file on disk. Quit the phone mid-dead-zone and
 * reopen it — the queue is still there, which is the entire point.
 */
export class FileClientStore implements SyncClientStore {
  private state: PersistedState;

  constructor(private readonly path: string) {
    if (existsSync(path)) {
      try {
        const raw = JSON.parse(readFileSync(path, "utf8")) as PersistedState;
        raw.server.forEach((dto) => receiptDtoSchema.parse(dto));
        raw.ops.forEach((dto) => receiptOpSchema.parse(dto));
        this.state = raw;
      } catch {
        console.error(`(state file ${path} was unreadable — starting a fresh phone)`);
        this.state = freshState();
      }
    } else {
      this.state = freshState();
    }
    this.persist();
  }

  get deviceId(): string {
    return this.state.deviceId;
  }

  get barnUrl(): string | null {
    return this.state.barnUrl;
  }

  setBarnUrl(url: string): void {
    this.state.barnUrl = url;
    this.persist();
  }

  reset(): void {
    this.state = freshState();
    this.persist();
  }

  async loadHlc(): Promise<Hlc | null> {
    return this.state.hlc === null ? null : hlcFromString(this.state.hlc);
  }

  async saveHlc(hlc: Hlc): Promise<void> {
    this.state.hlc = hlcToString(hlc);
    this.persist();
  }

  async loadCursor(): Promise<number> {
    return this.state.cursor;
  }

  async saveCursor(cursor: number): Promise<void> {
    this.state.cursor = cursor;
    this.persist();
  }

  async getServerReceipt(id: string): Promise<ReceiptProps | null> {
    const dto = this.state.server.find((entry) => entry.id === id);
    return dto === undefined ? null : receiptFromDto(dto);
  }

  async upsertServerReceipt(props: ReceiptProps): Promise<void> {
    const dto = receiptToDto(props);
    const index = this.state.server.findIndex((entry) => entry.id === dto.id);
    if (index === -1) this.state.server.push(dto);
    else this.state.server[index] = dto;
    this.persist();
  }

  async listServerReceipts(): Promise<ReceiptProps[]> {
    return this.state.server.map(receiptFromDto);
  }

  async enqueueOp(op: ReceiptOp): Promise<void> {
    this.state.ops.push(opToDto(op));
    this.persist();
  }

  async pendingOps(): Promise<ReceiptOp[]> {
    return this.state.ops.map(opFromDto);
  }

  async removeOps(opIds: readonly string[]): Promise<void> {
    const done = new Set(opIds);
    this.state.ops = this.state.ops.filter((op) => !done.has(op.opId));
    this.persist();
  }

  async enqueueImage(image: PendingImage): Promise<void> {
    this.state.images.push(image);
    this.persist();
  }

  async pendingImages(): Promise<PendingImage[]> {
    return [...this.state.images];
  }

  async removeImage(ref: string): Promise<void> {
    this.state.images = this.state.images.filter((image) => image.ref !== ref);
    this.persist();
  }

  private persist(): void {
    writeFileSync(this.path, JSON.stringify(this.state, null, 2));
  }
}
