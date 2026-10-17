import { parseArgs } from "node:util";
import { home, search, searchAll } from "./api.js";
import { format, toRows } from "./format.js";
import { inspect } from "./inspect.js";
import { formatInspection, summarize } from "./inspect-format.js";

const USAGE = `chatgpt-plugins — unofficial ChatGPT plugin search + inspector

Usage:
  chatgpt-plugins <query> [options]        search plugins (e.g. "google")
  chatgpt-plugins home [options]           show the featured/browse sections
  chatgpt-plugins inspect <name|id> [opts] inspect a plugin's connector + compatibility
  chatgpt-plugins inspect --plugin-json <f> --connector-json <g>

Search options:
  -n, --limit <n>      results per page (default 16)
      --all            follow pagination and combine pages
      --max-pages <n>  cap for --all (default 10)
      --scope <s>      GLOBAL | WORKSPACE (default GLOBAL)
      --category <id>  filter by plugin_category_id
      --page-token <t> continue from a previous page
      --links          print only the plugin URLs

Inspect options:
      --plugin-json <file>     offline plugin metadata (detail or search response)
      --connector-json <file>  offline connector metadata (bypasses the auth-gated endpoint)
      --include-actions        include connector actions when the endpoint is reachable
      --summary                print a one-line tab-separated summary
      --token <t>              your own bearer token (or CGP_ACCESS_TOKEN)
      --cookie <c>             your own cookie header (or CGP_COOKIE)

Global options:
      --json           print JSON (raw API response for search; report for inspect)
      --device-id <id> override the oai-device-id header
      --lang <tag>     oai-language header (default en-US)
  -h, --help           show this help

Examples:
  chatgpt-plugins google
  chatgpt-plugins google --json | jq '.plugins[].release.display_name'
  chatgpt-plugins inspect alphaxiv
  chatgpt-plugins inspect alphaxiv --json
  chatgpt-plugins inspect plugin_asdk_app_6a69834b831c8191a0281d6aca1722f0
  chatgpt-plugins inspect --plugin-json ./plugin.json --connector-json ./connector.json

Note: the inspect endpoints are experimental and undocumented; the connector
endpoint requires authentication. Nothing here verifies a live connection.`;

const OPTIONS = {
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
  "plugin-json": { type: "string" },
  "connector-json": { type: "string" },
  "include-actions": { type: "boolean" },
  summary: { type: "boolean" },
  token: { type: "string" },
  cookie: { type: "string" },
  help: { type: "boolean", short: "h" },
};

export function parseArgv(argv) {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    strict: false,
    options: OPTIONS,
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

function context(values) {
  return {
    deviceId: values["device-id"],
    language: values.lang,
    credentials: {
      token: values.token ?? process.env.CGP_ACCESS_TOKEN,
      cookie: values.cookie ?? process.env.CGP_COOKIE,
    },
  };
}

async function runInspect(values, positionals, out) {
  const pluginJson = values["plugin-json"];
  const connectorJson = values["connector-json"];
  const target = positionals[0];

  if (!target && !pluginJson) {
    throw new Error("inspect: provide a plugin name/ID, or --plugin-json <file>");
  }

  const report = await inspect(target, {
    pluginJson,
    connectorJson,
    includeActions: Boolean(values["include-actions"]),
    offline: Boolean(pluginJson || connectorJson),
    ...context(values),
  });

  const mode = values.json ? "json" : values.summary ? "summary" : "table";
  out(formatInspection(report, { mode }));
  return report.resolution?.status === "not_found" || report.resolution?.status === "ambiguous" ? 2 : 0;
}

export async function run(argv, out = console.log) {
  const { values, positionals } = parseArgv(argv);

  if (values.help || (positionals.length === 0 && !values["plugin-json"])) {
    out(USAGE);
    return 0;
  }

  if (positionals[0] === "inspect") {
    return runInspect(values, positionals.slice(1), out);
  }

  const mode = values.json ? "json" : values.links ? "links" : "table";
  const common = context(values);

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
