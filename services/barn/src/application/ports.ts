import type { ImageMediaType } from "@saddlebag/domain";

export interface StoredImage {
  base64: string;
  mediaType: ImageMediaType;
}

/** Port: where uploaded receipt photos live (filesystem here, object storage in a real barn). */
export interface BlobStore {
  put(ref: string, image: StoredImage): Promise<void>;
  get(ref: string): Promise<StoredImage | null>;
}
