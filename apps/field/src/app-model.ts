import * as Crypto from "expo-crypto";
import { Platform } from "react-native";

import type { SyncPullRequest, SyncPushRequest } from "@saddlebag/contracts";
import { HttpSyncTransport, SyncEngine, type SyncTransport } from "@saddlebag/sync";

import { SqliteClientStore } from "./sqlite-client-store";

/** iOS simulator reaches the host on localhost; the Android emulator via 10.0.2.2. */
export const DEFAULT_BARN_URL: string = Platform.select({
  android: "http://10.0.2.2:4477",
  default: "http://127.0.0.1:4477",
});

/** Lets the settings row repoint the barn without rebuilding the engine. */
export class SwitchableTransport implements SyncTransport {
  constructor(public url: string) {}

  push(request: SyncPushRequest) {
    return new HttpSyncTransport(this.url).push(request);
  }

  pull(request: SyncPullRequest) {
    return new HttpSyncTransport(this.url).pull(request);
  }

  uploadImage(ref: string, base64: string, mediaType: string) {
    return new HttpSyncTransport(this.url).uploadImage(ref, base64, mediaType);
  }
}

export interface AppModel {
  engine: SyncEngine;
  store: SqliteClientStore;
  transport: SwitchableTransport;
  deviceId: string;
}

export async function initAppModel(): Promise<AppModel> {
  const store = await SqliteClientStore.open("saddlebag.db");
  let deviceId = await store.loadSetting("deviceId");
  if (deviceId === null) {
    deviceId = `field-${Crypto.randomUUID().slice(0, 8)}`;
    await store.saveSetting("deviceId", deviceId);
  }
  const transport = new SwitchableTransport((await store.loadSetting("barnUrl")) ?? DEFAULT_BARN_URL);
  const engine = new SyncEngine({
    store,
    transport,
    deviceId,
    newId: () => Crypto.randomUUID(),
  });
  return { engine, store, transport, deviceId };
}
