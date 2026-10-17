import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const BASE_URL = "https://chatgpt.com";
export const SEARCH_PATH = "/backend-anon/ps/plugins/search";
export const HOME_PATH = "/backend-anon/ps/plugins/home";

const CONFIG_DIR = join(homedir(), ".config", "chatgpt-plugins");
const DEVICE_ID_FILE = join(CONFIG_DIR, "device-id");

// The web app always sends a per-device UUID. Without it Cloudflare answers 451.
export function resolveDeviceId(explicit) {
  if (explicit) return explicit;
  if (process.env.OAI_DEVICE_ID) return process.env.OAI_DEVICE_ID;
  try {
    const saved = readFileSync(DEVICE_ID_FILE, "utf8").trim();
    if (saved) return saved;
  } catch {
    // no saved id yet
  }
  const id = randomUUID();
  try {
    mkdirSync(CONFIG_DIR, { recursive: true });
    writeFileSync(DEVICE_ID_FILE, id, { mode: 0o600 });
  } catch {
    // best effort: a fresh id per run still works
  }
  return id;
}

export function buildHeaders({ deviceId, language = "en-US" } = {}) {
  return {
    "user-agent": `chatgpt-plugins-cli/0.1 (+node ${process.version})`,
    "oai-device-id": resolveDeviceId(deviceId),
    "oai-language": language,
    accept: "*/*",
  };
}

export function pluginUrl(plugin) {
  return `${BASE_URL}/plugins/${plugin.id}`;
}

export function searchUrl({ query = "google", scope = "GLOBAL", limit = 16, categoryId, pageToken, baseUrl = BASE_URL } = {}) {
  const url = new URL(SEARCH_PATH, baseUrl);
  url.searchParams.set("q", query);
  url.searchParams.set("scope", scope);
  url.searchParams.set("limit", String(limit));
  if (categoryId) url.searchParams.set("categoryId", categoryId);
  if (pageToken) url.searchParams.set("pageToken", pageToken);
  return url.toString();
}

async function requestJson(url, headers) {
  let res;
  try {
    res = await fetch(url, { headers });
  } catch (cause) {
    throw new Error(`Network error reaching ${url}: ${cause.message}`);
  }
  if (!res.ok) {
    let hint = "";
    if (res.status === 451) {
      hint = " (Cloudflare geo/bot block — try a different network/region)";
    } else if (res.status === 403) {
      hint = " (Cloudflare challenge — a valid oai-device-id and non-datacenter IP help)";
    }
    throw new Error(`HTTP ${res.status} from ${url}${hint}`);
  }
  return res.json();
}

export async function search({ deviceId, language, baseUrl, ...opts } = {}) {
  const url = searchUrl({ baseUrl, ...opts });
  return requestJson(url, buildHeaders({ deviceId, language }));
}

export async function searchAll({ maxPages = 10, limit = 50, ...opts } = {}) {
  const plugins = [];
  let pageToken;
  let pages = 0;
  do {
    const page = await search({ ...opts, limit, pageToken });
    plugins.push(...(page.plugins ?? []));
    pageToken = page.pagination?.next_page_token ?? undefined;
    pages += 1;
  } while (pageToken && pages < maxPages);
  return { plugins, pages, truncated: Boolean(pageToken) };
}

export async function home({ deviceId, language, baseUrl = BASE_URL } = {}) {
  return requestJson(new URL(HOME_PATH, baseUrl).toString(), buildHeaders({ deviceId, language }));
}
