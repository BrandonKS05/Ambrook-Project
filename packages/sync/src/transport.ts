import {
  syncPullResponseSchema,
  syncPushResponseSchema,
  type SyncPullRequest,
  type SyncPullResponse,
  type SyncPushRequest,
  type SyncPushResponse,
} from "@saddlebag/contracts";

export interface SyncTransport {
  push(request: SyncPushRequest): Promise<SyncPushResponse>;
  pull(request: SyncPullRequest): Promise<SyncPullResponse>;
  uploadImage(ref: string, base64: string, mediaType: string): Promise<void>;
}

type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string },
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

/**
 * Fetch-based transport shared by React Native and node. Responses are
 * zod-validated on the way in — a client never trusts the wire, even its own.
 */
export class HttpSyncTransport implements SyncTransport {
  private readonly baseUrl: string;
  private readonly fetchFn: FetchLike;

  constructor(baseUrl: string, fetchFn?: FetchLike) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.fetchFn =
      fetchFn ?? ((url, init) => (globalThis as unknown as { fetch: FetchLike }).fetch(url, init));
  }

  async push(request: SyncPushRequest): Promise<SyncPushResponse> {
    return syncPushResponseSchema.parse(await this.postJson("/sync/push", request));
  }

  async pull(request: SyncPullRequest): Promise<SyncPullResponse> {
    return syncPullResponseSchema.parse(await this.postJson("/sync/pull", request));
  }

  async uploadImage(ref: string, base64: string, mediaType: string): Promise<void> {
    await this.postJson(`/images/${encodeURIComponent(ref)}`, { base64, mediaType });
  }

  private async postJson(path: string, body: unknown): Promise<unknown> {
    const response = await this.fetchFn(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      throw new Error(`${path} failed: HTTP ${response.status}`);
    }
    return response.json();
  }
}
