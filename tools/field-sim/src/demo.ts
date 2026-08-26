import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { composeBarn } from "@saddlebag/barn/compose";
import { formatCents, scheduleFLabel, type Receipt } from "@saddlebag/domain";
import { HttpSyncTransport, InMemoryClientStore, SyncEngine, type FlushReport } from "@saddlebag/sync";

// A 1x1 jpeg — stands in for the receipt photo a phone camera would produce.
const SAMPLE_JPEG =
  "/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEB" +
  "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQH/wAALCAABAAEBAREA/8QAFAABAAAAAAAA" +
  "AAAAAAAAAAAAC//EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AVN//2Q==";

const line = (text = "") => console.log(text);
const say = (text: string) => console.log(`\n${text}`);

function showReceipts(label: string, receipts: Array<{ receipt: Receipt; pendingOps: number }>) {
  line(`  ${label}`);
  for (const { receipt, pendingOps } of receipts) {
    const f = receipt.fields;
    const status = receipt.status.toUpperCase().padEnd(9);
    const pending = pendingOps > 0 ? `  [${pendingOps} op(s) in the saddlebag]` : "";
    line(
      `   · ${status} ${(f.vendor ?? "(no vendor)").padEnd(22)} ${
        f.totalCents === null ? "—".padStart(9) : formatCents(f.totalCents).padStart(9)
      }  ${f.category === null ? "" : scheduleFLabel(f.category)}${pending}`,
    );
    if (receipt.suggestion !== null && !receipt.isApproved) {
      line(
        `       🤖 suggests ${scheduleFLabel(receipt.suggestion.line)} (${Math.round(
          receipt.suggestion.confidence * 100,
        )}%) — ${receipt.suggestion.rationale}`,
      );
    }
    for (const conflict of receipt.conflictLog) {
      line(
        `       ⚡ conflict on ${conflict.field}: kept "${String(conflict.kept)}", dropped "${String(
          conflict.discarded,
        )}" from ${conflict.discardedFrom}`,
      );
    }
  }
}

function showFlush(report: FlushReport) {
  line(
    `   ⇄ flush: ${report.uploadedImages} image(s) up, ${report.applied} op(s) applied, ` +
      `${report.duplicates} duplicate(s), ${report.rejected.length} rejected, ${report.pulled} receipt(s) pulled`,
  );
}

const dataDir = mkdtempSync(join(tmpdir(), "saddlebag-demo-"));
const { app, categorizerMode } = composeBarn({
  dbPath: join(dataDir, "barn.sqlite"),
  blobDir: join(dataDir, "blobs"),
});
await app.listen({ port: 0, host: "127.0.0.1" });
const address = app.server.address();
const barnUrl = typeof address === "object" && address !== null ? `http://127.0.0.1:${address.port}` : "";

line("🐴 saddlebag field demo");
line(`   barn listening at ${barnUrl} (sqlite in ${dataDir}, categorizer: ${categorizerMode})`);

const phone = new SyncEngine({
  store: new InMemoryClientStore(),
  transport: new HttpSyncTransport(barnUrl),
  deviceId: "phone-in-the-truck",
});
const office = new SyncEngine({
  store: new InMemoryClientStore(),
  transport: new HttpSyncTransport(barnUrl),
  deviceId: "barn-office",
});

say("— 7:40 AM, north pasture. No bars on the phone. Three receipts get captured anyway:");
const fuel = await phone.capture({
  initial: { vendor: "Cenex Co-op", totalCents: 31255, memo: "diesel for the baler" },
  image: { base64: SAMPLE_JPEG, mediaType: "image/jpeg" },
});
const fence = await phone.capture({
  initial: { vendor: "Tractor Supply Co", totalCents: 18437, memo: "t-posts and staples, north fence" },
});
await phone.capture({
  initial: { vendor: "Valley Vet Supply", totalCents: 9620, memo: "LA-300 and syringes" },
});
showReceipts("phone (offline — everything queued locally):", await phone.list());

say("— 12:15 PM, back in cell range. The saddlebag unloads:");
showFlush(await phone.flush());
showReceipts("phone (after sync — the barn's categorizer weighed in):", await phone.list());

say("— The rancher approves the fuel receipt from the phone:");
await phone.approve(fuel, "F19");
showFlush(await phone.flush());

say("— Meanwhile: the phone re-tags the fencing receipt OFFLINE while the office edits the same field…");
await phone.edit(fence, { category: "F28" });
await new Promise((resolve) => setTimeout(resolve, 25));
await office.flush();
await office.edit(fence, { category: "F32" });
await office.flush();

say("— The phone comes back online and syncs. Later write wins; the loser is logged, not lost:");
showFlush(await phone.flush());
showReceipts("phone (merged — office's later edit won, conflict preserved for review):", await phone.list());

say("— The office pulls once more and sees the same books:");
await office.flush();
showReceipts("office:", await office.list());

line();
line("✓ offline capture → outbox → idempotent sync → AI suggestion → human approval → conflict audit");
line(`  review queue UI (while this process lives): ${barnUrl}/`);

await app.close();
