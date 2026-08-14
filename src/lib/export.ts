/** Escape a cell for CSV output. */
function esc(value: string | number): string {
  const s = String(value);
  if (/[",\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/** Convert rows (arrays of cells) to a CSV string. */
export function toCSV(rows: (string | number)[][]): string {
  return rows.map(r => r.map(esc).join(",")).join("\n");
}

/** Trigger a browser download of a CSV file. */
export function downloadCSV(filename: string, rows: (string | number)[][]): void {
  const csv = toCSV(rows);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
