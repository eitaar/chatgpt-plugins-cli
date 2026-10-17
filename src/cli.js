import { parseArgs } from "node:util";
import { home, search, searchAll } from "./api.js";
import { format, toRows } from "./format.js";

const USAGE = `chatgpt-plugins — unofficial ChatGPT plugin search

Usage:
  chatgpt-plugins <query> [options]        search plugins (e.g. "google")
  chatgpt-plugins home [options]           show the featured/browse sections

Options:
  -n, --limit <n>      results per page (default 16)
      --all            follow pagination and combine pages
      --max-pages <n>  cap for --all (default 10)
      --scope <s>      GLOBAL | WORKSPACE (default GLOBAL)
      --category <id>  filter by plugin_category_id
      --page-token <t> continue from a previous page
      --json           print the raw API response
      --links          print only the plugin URLs
      --device-id <id> override the oai-device-id header
      --lang <tag>     oai-language header (default en-US)
  -h, --help           show this help

Examples:
  chatgpt-plugins google
  chatgpt-plugins google --json | jq '.plugins[].release.display_name'
  chatgpt-plugins "github" --all --links
  chatgpt-plugins home --json`;

export function parseArgv(argv) {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    strict: false,
    options: {
      limit: { type: "string", short: "n" },
      all: { type: "boolean" },
      "max-pages": { type: "string" },
      scope: { type: "string" },
      category: { type: "string" },
      "page-token": { type: "string" },
      json: { type: "boolean" },
      links: { type: "boolean" },
      "device-id": { type: "string" },
      lang: { type: "string" },
      help: { type: "boolean", short: "h" },
    },
  });
  return { values, positionals };
}

function positiveInt(raw, fallback, name) {
  if (raw === undefined) return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error(`--${name} must be a positive integer (got "${raw}")`);
  }
  return n;
}

export async function run(argv, out = console.log) {
  const { values, positionals } = parseArgv(argv);

  if (values.help || positionals.length === 0) {
    out(USAGE);
    return 0;
  }

  const mode = values.json ? "json" : values.links ? "links" : "table";
  const common = {
    deviceId: values["device-id"],
    language: values.lang,
  };

  if (positionals[0] === "home") {
    const res = await home(common);
    if (mode === "json") {
      out(format({ res, rows: [], mode: "json" }));
      return 0;
    }
    const sections = res.sections ?? [];
    const blocks = sections.map((section) => {
      const rows = toRows({ plugins: section.plugins ?? [] });
      return format({ rows, mode: mode === "links" ? "links" : "table", label: `${section.title} (${section.url_slug})` });
    });
    out(blocks.join("\n\n"));
    return 0;
  }

  const query = positionals.join(" ");
  const limit = positiveInt(values.limit, 16, "limit");
  const base = {
    ...common,
    query,
    scope: values.scope,
    limit,
    categoryId: values.category,
  };

  const res = values.all
    ? await searchAll({ ...base, maxPages: positiveInt(values["max-pages"], 10, "max-pages") })
    : await search({ ...base, pageToken: values["page-token"] });

  const rows = toRows(res);
  const label = `"${query}"${values.all && res.truncated ? " (page cap reached — more available)" : ""}`;
  out(format({ res, rows, mode, label }));
  return 0;
}
