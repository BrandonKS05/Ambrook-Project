import { SCHEDULE_F_LINES } from "@saddlebag/domain";

const LINE_OPTIONS = JSON.stringify(
  SCHEDULE_F_LINES.map((entry) => ({ id: entry.id, label: `${entry.line} · ${entry.label}` })),
);

/**
 * The barn's review queue. Deliberately just another sync client: every edit
 * and approval it makes goes through POST /sync/push as ops from device
 * "barn", the same write path the phones use.
 */
export const REVIEW_PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>saddlebag barn</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { margin: 0; font: 15px/1.45 ui-sans-serif, system-ui, sans-serif; background: #f4f1ea; color: #2b2620; }
  header { padding: 18px 24px; border-bottom: 2px solid #2b2620; display: flex; align-items: baseline; gap: 12px; }
  header h1 { margin: 0; font-size: 18px; letter-spacing: 0.02em; }
  header span { color: #6f675c; font-size: 13px; }
  main { max-width: 880px; margin: 0 auto; padding: 20px 24px 60px; }
  .card { background: #fffdf8; border: 1.5px solid #2b2620; border-radius: 10px; margin: 14px 0; padding: 14px 16px; display: grid; grid-template-columns: 84px 1fr; gap: 14px; }
  .thumb { width: 84px; height: 84px; object-fit: cover; border-radius: 6px; border: 1px solid #c9c1b2; background: #eee7d9; }
  .thumb.empty { display: flex; align-items: center; justify-content: center; color: #a39a8a; font-size: 24px; }
  .row { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin: 3px 0; }
  .vendor { font-weight: 700; }
  .total { font-variant-numeric: tabular-nums; }
  .chip { font-size: 12px; border: 1px solid #2b2620; border-radius: 999px; padding: 1px 9px; }
  .chip.captured { background: #eee7d9; }
  .chip.suggested { background: #fff3c4; }
  .chip.approved { background: #d7ecc8; }
  .suggestion { font-size: 13px; color: #4c4438; background: #f6efdf; border-radius: 6px; padding: 6px 9px; margin-top: 6px; }
  .conflict { font-size: 12.5px; color: #8a3b2b; margin-top: 6px; }
  .controls { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 9px; }
  select, input, button { font: inherit; font-size: 13.5px; border: 1.5px solid #2b2620; border-radius: 7px; padding: 4px 9px; background: #fffdf8; }
  input { width: 130px; }
  button { cursor: pointer; background: #2b2620; color: #fffdf8; }
  button.ghost { background: #fffdf8; color: #2b2620; }
  .empty-state { text-align: center; color: #6f675c; margin-top: 60px; }
</style>
</head>
<body>
<header><h1>🐴 saddlebag barn</h1><span>review queue — edits here sync back to every device</span></header>
<main id="list"><p class="empty-state">Loading…</p></main>
<script>
const LINES = ${LINE_OPTIONS};
const label = (id) => (LINES.find((l) => l.id === id) || { label: id }).label;
const money = (cents) => cents == null ? "—" : "$" + (cents / 100).toFixed(2).replace(/\\B(?=(\\d{3})+(?!\\d))/g, ",");
const hlc = () => String(Date.now()).padStart(15, "0") + "-000000-barn";

async function pushOps(ops) {
  await fetch("/sync/push", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ deviceId: "barn", ops }),
  });
  await refresh();
}

function op(receipt, rest) {
  return { opId: crypto.randomUUID(), receiptId: receipt.id, deviceId: "barn", baseRev: receipt.rev, at: hlc(), ...rest };
}

function card(r) {
  const f = Object.fromEntries(Object.entries(r.fields).map(([k, v]) => [k, v.value]));
  const status = r.approved.value ? "approved" : r.suggestion ? "suggested" : "captured";
  const el = document.createElement("section");
  el.className = "card";
  el.innerHTML =
    (r.imageRef
      ? '<img class="thumb" src="/images/' + r.imageRef + '" alt="receipt">'
      : '<div class="thumb empty">🧾</div>') +
    '<div>' +
      '<div class="row"><span class="vendor">' + (f.vendor ?? "(no vendor yet)") + '</span>' +
      '<span class="total">' + money(f.totalCents) + '</span>' +
      '<span>' + (f.purchasedAt ?? "") + '</span>' +
      '<span class="chip ' + status + '">' + status + '</span></div>' +
      (f.memo ? '<div class="row">📝 ' + f.memo + '</div>' : "") +
      (f.category ? '<div class="row">📒 ' + label(f.category) + '</div>' : "") +
      (r.suggestion
        ? '<div class="suggestion">🤖 ' + label(r.suggestion.line) + " · " + Math.round(r.suggestion.confidence * 100) + "% — " + r.suggestion.rationale + "</div>"
        : "") +
      r.conflictLog.map((c) => '<div class="conflict">⚡ ' + c.field + ": kept “" + c.kept + "”, dropped “" + c.discarded + "” from " + c.discardedFrom + "</div>").join("") +
      '<div class="controls"></div>' +
    '</div>';

  const controls = el.querySelector(".controls");
  const select = document.createElement("select");
  for (const line of LINES) {
    const option = document.createElement("option");
    option.value = line.id;
    option.textContent = line.label;
    select.appendChild(option);
  }
  select.value = f.category ?? (r.suggestion ? r.suggestion.line : "F32");

  const approve = document.createElement("button");
  approve.textContent = r.approved.value ? "Re-approve" : "Approve";
  approve.onclick = () => pushOps([op(r, { kind: "approve", category: select.value })]);

  const vendor = document.createElement("input");
  vendor.placeholder = "vendor";
  vendor.value = f.vendor ?? "";
  const save = document.createElement("button");
  save.className = "ghost";
  save.textContent = "Save";
  save.onclick = () => {
    const set = {};
    if (vendor.value.trim() && vendor.value !== f.vendor) set.vendor = vendor.value.trim();
    set.category = select.value;
    pushOps([op(r, { kind: "patch", set })]);
  };

  controls.append(select, approve, vendor, save);
  return el;
}

async function refresh() {
  const { receipts } = await (await fetch("/receipts")).json();
  const list = document.getElementById("list");
  list.replaceChildren();
  if (receipts.length === 0) {
    list.innerHTML = '<p class="empty-state">Nothing in the barn yet — capture something in the field.</p>';
    return;
  }
  receipts
    .sort((a, b) => b.capturedAt.localeCompare(a.capturedAt))
    .forEach((r) => list.appendChild(card(r)));
}

refresh();
setInterval(refresh, 3000);
</script>
</body>
</html>`;
