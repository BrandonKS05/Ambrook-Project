import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { imageUploadRequestSchema } from "@saddlebag/contracts";
import { InvariantViolationError } from "@saddlebag/domain";

import type { BlobStore, StoredImage } from "../application/ports.js";

const SAFE_REF = /^[A-Za-z0-9_-]+$/;

function assertSafeRef(ref: string): void {
  if (!SAFE_REF.test(ref)) {
    throw new InvariantViolationError(`unsafe image ref: "${ref}"`);
  }
}

export class FsBlobStore implements BlobStore {
  constructor(private readonly dir: string) {}

  async put(ref: string, image: StoredImage): Promise<void> {
    assertSafeRef(ref);
    await mkdir(this.dir, { recursive: true });
    await writeFile(join(this.dir, `${ref}.json`), JSON.stringify(image));
  }

  async get(ref: string): Promise<StoredImage | null> {
    assertSafeRef(ref);
    try {
      const raw = await readFile(join(this.dir, `${ref}.json`), "utf8");
      return imageUploadRequestSchema.parse(JSON.parse(raw));
    } catch (error) {
      if ((error as { code?: string }).code === "ENOENT") return null;
      throw error;
    }
  }
}

export class InMemoryBlobStore implements BlobStore {
  private readonly images = new Map<string, StoredImage>();

  async put(ref: string, image: StoredImage): Promise<void> {
    assertSafeRef(ref);
    this.images.set(ref, image);
  }

  async get(ref: string): Promise<StoredImage | null> {
    assertSafeRef(ref);
    return this.images.get(ref) ?? null;
  }
}
