/**
 * IRS Schedule F (Form 1040) Part II expense lines. Sub-lines (21a/b, 24a/b)
 * are collapsed to their parent line — the split is a filing detail, not a
 * categorization decision a reviewer makes in the field.
 */
export const SCHEDULE_F_LINES = [
  { id: "F10", line: "10", label: "Car and truck expenses" },
  { id: "F11", line: "11", label: "Chemicals" },
  { id: "F12", line: "12", label: "Conservation expenses" },
  { id: "F13", line: "13", label: "Custom hire (machine work)" },
  { id: "F14", line: "14", label: "Depreciation and section 179" },
  { id: "F15", line: "15", label: "Employee benefit programs" },
  { id: "F16", line: "16", label: "Feed" },
  { id: "F17", line: "17", label: "Fertilizers and lime" },
  { id: "F18", line: "18", label: "Freight and trucking" },
  { id: "F19", line: "19", label: "Gasoline, fuel, and oil" },
  { id: "F20", line: "20", label: "Insurance (other than health)" },
  { id: "F21", line: "21", label: "Interest" },
  { id: "F22", line: "22", label: "Labor hired" },
  { id: "F23", line: "23", label: "Pension and profit-sharing plans" },
  { id: "F24", line: "24", label: "Rent or lease" },
  { id: "F25", line: "25", label: "Repairs and maintenance" },
  { id: "F26", line: "26", label: "Seeds and plants" },
  { id: "F27", line: "27", label: "Storage and warehousing" },
  { id: "F28", line: "28", label: "Supplies" },
  { id: "F29", line: "29", label: "Taxes" },
  { id: "F30", line: "30", label: "Utilities" },
  { id: "F31", line: "31", label: "Veterinary, breeding, and medicine" },
  { id: "F32", line: "32", label: "Other expenses" },
] as const;

export type ScheduleFLineId = (typeof SCHEDULE_F_LINES)[number]["id"];

export const SCHEDULE_F_LINE_IDS = SCHEDULE_F_LINES.map((entry) => entry.id) as [
  ScheduleFLineId,
  ...ScheduleFLineId[],
];

export function isScheduleFLineId(value: string): value is ScheduleFLineId {
  return SCHEDULE_F_LINES.some((entry) => entry.id === value);
}

export function scheduleFLabel(id: ScheduleFLineId): string {
  const entry = SCHEDULE_F_LINES.find((candidate) => candidate.id === id);
  return entry === undefined ? id : `${entry.line} · ${entry.label}`;
}
