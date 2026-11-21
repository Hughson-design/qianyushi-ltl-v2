export type HistorySortKey = "quote_number" | "bol_number" | "reference" | "route" | "origin_zip" | "destination_zip" | "customer" | "carrier" | "ready_date" | "status" | "price";
export type HistorySort = { key: HistorySortKey; direction: "asc" | "desc" };

type HistoryRow = {
  quote_number: string; bol_number: string | null; reference: string;
  origin_zip: string; destination_zip: string; receiver: { company: string };
  carrier: string; ready_date: string | null; status: string; price: number | string;
};

const collator = new Intl.Collator("en", { numeric: true, sensitivity: "base" });

export function nextHistorySort(current: HistorySort | null, key: HistorySortKey): HistorySort {
  return { key, direction: current?.key === key && current.direction === "asc" ? "desc" : "asc" };
}

export function sortHistory<T extends HistoryRow>(rows: T[], sort: HistorySort | null, statusLabels: Record<string, string>): T[] {
  if (!sort) return rows;
  const value = (row: T): string | number | null => {
    if (sort.key === "price") return row.price === "" || !Number.isFinite(Number(row.price)) ? null : Number(row.price);
    if (sort.key === "customer") return row.receiver?.company?.trim() || null;
    if (sort.key === "route") return `${row.origin_zip} → ${row.destination_zip}`;
    if (sort.key === "status") return statusLabels[row.status] || row.status;
    return row[sort.key]?.trim() || null;
  };
  // Blank cells stay at the bottom in both directions; equal values keep server order.
  return [...rows].sort((a, b) => {
    const left = value(a), right = value(b);
    if (left === null || right === null) return left === right ? 0 : left === null ? 1 : -1;
    const compared = typeof left === "number" && typeof right === "number" ? left - right : collator.compare(String(left), String(right));
    return sort.direction === "asc" ? compared : -compared;
  });
}
