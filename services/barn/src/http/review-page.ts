import { SCHEDULE_F_LINES } from "@saddlebag/domain";

const LINE_OPTIONS = JSON.stringify(
  SCHEDULE_F_LINES.map((entry) => ({ id: entry.id, label: `${entry.line} ${entry.label}` })),
);

/**
 * The barn's review queue: one plain table, spreadsheet-style. Deliberately
 * just another sync client — every edit and approval it makes goes through
 * POST /sync/push as ops from device "barn", the same write path the phones
 * use.
 */
export const REVIEW_PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>saddlebag barn</title>
<style>
  body { margin: 0; font: 13px/1.45 -apple-system, "Segoe UI", system-ui, sans-serif; background: #fff; color: #222; }
  .bar { padding: 7px 12px; border-bottom: 1px solid #c9c9c9; font-weight: 700; }
  .bar small { font-weight: 400; color: #777; margin-left: 8px; }
  table { border-collapse: collapse; margin: 12px; }
  th, td { border: 1px solid #d4d4d4; padding: 3px 8px; text-align: left; vertical-align: top; }
  th { background: #f2f2f2; font-weight: 600; white-space: nowrap; }
  td.num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  td input { border: none; font: inherit; width: 150px; background: transparent; padding: 0; }
  td input:focus { outline: 1px solid #4a7dbd; background: #ffffe0; }
  select, button { font: inherit; }
  button { border: 1px solid #999; border-radius: 0; background: #f6f6f6; padding: 1px 8px; cursor: pointer; }
  button:hover { background: #ececec; }
  .memo { color: #666; font-size: 12px; }
  .sug { color: #555; max-width: 300px; }
  .captured { color: #666; } .suggested { color: #9a6700; } .approved { color: #1a7f37; }
  .conflict { color: #b3261e; font-size: 12px; }
  .empty { color: #777; margin: 24px 12px; }
  a { color: #24578f; }
</style>
</head>
<body>
<div class="bar">saddlebag barn<small>review queue — edits here sync back to every device</small></div>
<div id="out"><p class="empty">Loading…</p></div>
<script>
const LINES = ${LINE_OPTIONS};
const label = (id) => (LINES.find((l) => l.id === id) || { label: id }).label;
const money = (c) => c == null ? "" : "$" + (c / 100).toFixed(2).replace(/\\B(?=(\\d{3})+(?!\\d))/g, ",");
const hlc = () => String(Date.now()).padStart(15, "0") + "-000000-barn";

async function pushOps(ops) {
  await fetch("/sync/push", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ deviceId: "barn", ops }),
  });
  await refresh();
}
const op = (r, rest) => ({ opId: crypto.randomUUID(), receiptId: r.id, deviceId: "barn", baseRev: r.rev, at: hlc(), ...rest });

function cell(...children) {
  const td = document.createElement("td");
  for (const child of children) td.append(child);
  return td;
}

function row(r) {
  const f = Object.fromEntries(Object.entries(r.fields).map(([k, v]) => [k, v.value]));
  const status = r.approved.value ? "approved" : r.suggestion ? "suggested" : "captured";
  const tr = document.createElement("tr");

  const vendor = document.createElement("input");
  vendor.value = f.vendor ?? "";
  const vendorTd = cell(vendor);
  if (f.memo) {
    const memo = document.createElement("div");
    memo.className = "memo";
    memo.textContent = f.memo;
    vendorTd.append(memo);
  }
  for (const c of r.conflictLog) {
    const div = document.createElement("div");
    div.className = "conflict";
    div.textContent = "conflict on " + c.field + ": kept " + JSON.stringify(c.kept) + ", dropped " + JSON.stringify(c.discarded) + " (" + c.discardedFrom + ")";
    vendorTd.append(div);
  }
  tr.append(vendorTd);

  const amount = cell(money(f.totalCents));
  amount.className = "num";
  tr.append(amount, cell(f.purchasedAt ?? ""));

  const sug = cell(r.suggestion ? label(r.suggestion.line) + " (" + Math.round(r.suggestion.confidence * 100) + "%) — " + r.suggestion.rationale : "");
  sug.className = "sug";
  tr.append(sug);

  const select = document.createElement("select");
  for (const line of LINES) {
    const option = document.createElement("option");
    option.value = line.id;
    option.textContent = line.label;
    select.append(option);
  }
  select.value = f.category ?? (r.suggestion ? r.suggestion.line : "F32");
  tr.append(cell(select));

  const statusSpan = document.createElement("span");
  statusSpan.className = status;
  statusSpan.textContent = status;
  tr.append(cell(statusSpan));

  if (r.imageRef) {
    const link = document.createElement("a");
    link.href = "/images/" + r.imageRef;
    link.target = "_blank";
    link.textContent = "img";
    tr.append(cell(link));
  } else {
    tr.append(cell(""));
  }

  const approve = document.createElement("button");
  approve.textContent = r.approved.value ? "re-approve" : "approve";
  approve.onclick = () => pushOps([op(r, { kind: "approve", category: select.value })]);
  const save = document.createElement("button");
  save.textContent = "save";
  save.onclick = () => {
    const set = { category: select.value };
    if (vendor.value.trim() && vendor.value !== f.vendor) set.vendor = vendor.value.trim();
    pushOps([op(r, { kind: "patch", set })]);
  };
  tr.append(cell(approve, " ", save));
  return tr;
}

async function refresh() {
  const { receipts } = await (await fetch("/receipts")).json();
  const out = document.getElementById("out");
  if (receipts.length === 0) {
    out.innerHTML = '<p class="empty">Nothing in the barn yet — capture something in the field.</p>';
    return;
  }
  const table = document.createElement("table");
  const head = document.createElement("tr");
  for (const title of ["vendor / memo", "amount", "date", "suggestion", "category", "status", "img", ""]) {
    const th = document.createElement("th");
    th.textContent = title;
    head.append(th);
  }
  table.append(head);
  receipts
    .sort((a, b) => b.capturedAt.localeCompare(a.capturedAt))
    .forEach((r) => table.append(row(r)));
  out.replaceChildren(table);
}

refresh();
setInterval(refresh, 3000);
</script>
</body>
</html>`;
