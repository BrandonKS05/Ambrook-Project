import { createInterface } from "node:readline";

import { formatCents, parseMoney, scheduleFLabel, type Receipt } from "@saddlebag/domain";
import { HttpSyncTransport, SyncEngine, type SyncTransport } from "@saddlebag/sync";

import { FileClientStore } from "./file-store.js";

const DEFAULT_BARN = "https://saddlebagbarn-production.up.railway.app";

const store = new FileClientStore(".phone-state.json");
if (process.env["BARN_URL"] !== undefined) store.setBarnUrl(process.env["BARN_URL"]);
if (store.barnUrl === null) store.setBarnUrl(DEFAULT_BARN);

class SwitchableTransport implements SyncTransport {
  push(request: Parameters<SyncTransport["push"]>[0]) {
    return new HttpSyncTransport(store.barnUrl ?? DEFAULT_BARN).push(request);
  }
  pull(request: Parameters<SyncTransport["pull"]>[0]) {
    return new HttpSyncTransport(store.barnUrl ?? DEFAULT_BARN).pull(request);
  }
  uploadImage(ref: string, base64: string, mediaType: string) {
    return new HttpSyncTransport(store.barnUrl ?? DEFAULT_BARN).uploadImage(ref, base64, mediaType);
  }
}

const engine = new SyncEngine({ store, transport: new SwitchableTransport(), deviceId: store.deviceId });

// Input is buffered by hand so piped scripts work: lines that arrive while
// the loop is busy queue up instead of vanishing between questions.
const rl = createInterface({ input: process.stdin, output: process.stdout });
const bufferedLines: string[] = [];
const waiters: Array<(line: string) => void> = [];
let stdinClosed = false;
rl.on("line", (line) => {
  const waiter = waiters.shift();
  if (waiter === undefined) bufferedLines.push(line);
  else waiter(line);
});
rl.on("close", () => {
  stdinClosed = true;
  for (const waiter of waiters.splice(0)) waiter("quit");
});

function ask(prompt: string): Promise<string> {
  process.stdout.write(prompt);
  const queued = bufferedLines.shift();
  if (queued !== undefined) {
    process.stdout.write(`${queued}\n`);
    return Promise.resolve(queued);
  }
  if (stdinClosed) return Promise.resolve("quit");
  return new Promise((resolve) => waiters.push(resolve));
}

function show(receipt: Receipt, pendingOps: number) {
  const f = receipt.fields;
  const status = receipt.status.toUpperCase().padEnd(9);
  const queued = pendingOps > 0 ? `  [${pendingOps} op(s) in the saddlebag]` : "";
  console.log(
    `  ${status} ${(f.vendor ?? "(no vendor)").padEnd(22)} ${
      f.totalCents === null ? "—".padStart(9) : formatCents(f.totalCents).padStart(9)
    }  ${f.category === null ? "" : scheduleFLabel(f.category)}${queued}`,
  );
  if (receipt.suggestion !== null && !receipt.isApproved) {
    const s = receipt.suggestion;
    console.log(`      🤖 suggests ${scheduleFLabel(s.line)} (${Math.round(s.confidence * 100)}%) — ${s.rationale}`);
  }
  for (const c of receipt.conflictLog) {
    console.log(`      ⚡ ${c.field}: kept "${String(c.kept)}", dropped "${String(c.discarded)}" (${c.discardedFrom})`);
  }
}

async function list() {
  const receipts = await engine.list();
  if (receipts.length === 0) {
    console.log("  (empty — try `stash`)");
    return;
  }
  for (const { receipt, pendingOps } of receipts) show(receipt, pendingOps);
}

async function stash() {
  const vendor = (await ask("  vendor: ")).trim();
  const amountText = (await ask("  amount ($): ")).trim();
  const memo = (await ask("  memo: ")).trim();
  const totalCents = amountText === "" ? null : parseMoney(amountText);
  if (amountText !== "" && totalCents === null) {
    console.log(`  couldn't read "${amountText}" as money — receipt not stashed`);
    return;
  }
  await engine.capture({
    initial: {
      vendor: vendor === "" ? null : vendor,
      totalCents,
      memo: memo === "" ? null : memo,
    },
  });
  console.log("  🎒 stashed. It syncs when you run `sync` (and there's signal).");
}

async function sync() {
  try {
    const report = await engine.flush();
    console.log(
      `  ⇄ synced: ${report.applied} applied, ${report.duplicates} duplicate(s), ` +
        `${report.rejected.length} rejected, ${report.pulled} pulled`,
    );
    for (const conflict of report.conflicts) {
      console.log(`  ⚡ merge: ${conflict.field} kept "${String(conflict.kept)}", dropped "${String(conflict.discarded)}"`);
    }
  } catch {
    console.log(`  📵 no signal (couldn't reach ${store.barnUrl}) — everything stays in the saddlebag.`);
  }
}

console.log(`🐴 saddlebag phone — device ${store.deviceId}, barn ${store.barnUrl}`);
console.log("   commands: stash · list · sync · barn <url> · reset · quit");

for (;;) {
  const pending = await engine.pendingCount();
  const badge = pending > 0 ? ` (🎒 ${pending} queued)` : "";
  const line = (await ask(`saddlebag${badge}> `)).trim();
  const [command, ...rest] = line.split(/\s+/);
  switch (command) {
    case "stash":
      await stash();
      break;
    case "list":
      await list();
      break;
    case "sync":
      await sync();
      break;
    case "barn": {
      const url = rest.join(" ").trim();
      if (url === "") console.log(`  barn is ${store.barnUrl}`);
      else {
        store.setBarnUrl(url.replace(/\/+$/, ""));
        console.log(`  barn set to ${store.barnUrl}`);
      }
      break;
    }
    case "reset":
      store.reset();
      console.log("  fresh phone. (new device id — rerun to pick it up)");
      rl.close();
      process.exit(0);
      break;
    case "quit":
    case "exit":
      rl.close();
      process.exit(0);
      break;
    case "":
      break;
    default:
      console.log("  commands: stash · list · sync · barn <url> · reset · quit");
  }
}
