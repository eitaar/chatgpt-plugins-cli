import { pluginUrl } from "./api.js";

const COLUMNS = [
  { header: "#", width: 3, cell: (r) => r.index },
  { header: "Name", width: 32, cell: (r) => r.display_name },
  { header: "Developer", width: 22, cell: (r) => r.developer_name },
  { header: "Category", width: 18, cell: (r) => r.category },
  { header: "Status", width: 9, cell: (r) => r.status },
];

function str(value) {
  return value == null ? "" : String(value);
}

function truncate(value, width) {
  const text = str(value);
  return text.length <= width ? text : `${text.slice(0, width - 1)}…`;
}

function padEnd(value, width) {
  const text = truncate(value, width);
  return text + " ".repeat(Math.max(0, width - text.length));
}

export function toRow(plugin, index) {
  const iface = plugin.release?.interface ?? {};
  return {
    index: index + 1,
    display_name: plugin.release?.display_name ?? plugin.display_name ?? plugin.name ?? "(unnamed)",
    developer_name: iface.developer_name ?? "",
    category: iface.category ?? "",
    status: plugin.status ?? "",
    short_description: iface.short_description ?? plugin.short_description ?? "",
    url: pluginUrl(plugin),
  };
}

export function toRows(res) {
  return (res.plugins ?? []).map(toRow);
}

function renderTable(rows) {
  const line = (cells) => cells.map((cell, i) => padEnd(cell, COLUMNS[i].width)).join("  ");
  const header = line(COLUMNS.map((c) => c.header));
  const divider = COLUMNS.map((c) => "-".repeat(c.width)).join("  ");
  const body = rows.map((row) => line(COLUMNS.map((c) => c.cell(row))));
  return [header, divider, ...body].join("\n");
}

export function format({ res, rows, mode = "table", label }) {
  if (mode === "json") {
    return JSON.stringify(res, null, 2);
  }
  if (mode === "links") {
    return rows.map((r) => r.url).join("\n");
  }
  const head = label ? `${label}\n` : "";
  if (rows.length === 0) {
    return `${head}No plugins found.`;
  }
  const links = rows.map((r) => `${String(r.index).padStart(2)}. ${r.display_name} — ${r.url}`).join("\n");
  return `${head}${renderTable(rows)}\n\n${links}\n\n${rows.length} plugin(s).`;
}
