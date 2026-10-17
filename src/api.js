import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const BASE_URL = "https://chatgpt.com";
export const SEARCH_PATH = "/backend-anon/ps/plugins/search";
export const HOME_PATH = "/backend-anon/ps/plugins/home";

// Experimental, undocumented internal endpoints. Shape and access can change.
export const PLUGIN_DETAIL_PATH = "/backend-api/ps/plugins";
export const CONNECTOR_PATH = "/backend-api/aip/connectors";

const CONFIG_DIR = join(homedir(), ".config", "chatgpt-plugins");
const DEVICE_ID_FILE = join(CONFIG_DIR, "device-id");

// Cloudflare 403s non-browser user-agents on the backend-api paths, so default
// to a realistic one (override with CGP_USER_AGENT).
export const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36";

let transport = globalThis.fetch;

// Tests inject a transport so no sockets are opened. Contract: (url, init) =>
// Response-like { ok, status, headers.get(name), text() }.
export function _setTransport(fn) {
  transport = fn ?? globalThis.fetch;
}

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

export function buildHeaders({ deviceId, language = "en-US", credentials = {}, userAgent } = {}) {
  const headers = {
    "user-agent": userAgent ?? process.env.CGP_USER_AGENT ?? DEFAULT_USER_AGENT,
    "oai-device-id": resolveDeviceId(deviceId),
    "oai-language": language,
    accept: "*/*",
  };
  // A user may supply their OWN token/cookie to read their own connector data.
  // We never scrape tokens from a browser session.
  const token = credentials.token ?? process.env.CGP_ACCESS_TOKEN;
  if (token) headers.authorization = `Bearer ${token}`;
  if (credentials.cookie) headers.cookie = credentials.cookie;
  return headers;
}

export function pluginUrl(plugin) {
  return `${BASE_URL}/plugins/${plugin.id}`;
}

export function pluginDetailUrl(pluginId, baseUrl = BASE_URL) {
  return `${baseUrl}${PLUGIN_DETAIL_PATH}/${encodeURIComponent(pluginId)}`;
}

export function connectorUrl(appId, { baseUrl = BASE_URL, includeActions = false } = {}) {
  const url = new URL(`${CONNECTOR_PATH}/${encodeURIComponent(appId)}`, baseUrl);
  url.searchParams.set("include_actions", String(Boolean(includeActions)));
  return url.toString();
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

function statusHint(status) {
  switch (status) {
    case 451:
      return "Cloudflare geo/bot block (send a valid oai-device-id, avoid datacenter IPs)";
    case 401:
      return "authentication required (supply your own token with --token / CGP_ACCESS_TOKEN)";
    case 403:
      return "access denied (connector metadata is auth-gated; use --connector-json with metadata you obtained yourself)";
    case 404:
      return "not found";
    default:
      return "";
  }
}

// Thrown for any non-2xx so callers can decide whether to fall back.
export class ApiError extends Error {
  constructor({ status, url, body, hint }) {
    const detail = extractDetail(body);
    const suffix = detail ? ` — ${detail}` : "";
    super(`HTTP ${status} from ${url}${suffix}`);
    this.name = "ApiError";
    this.status = status;
    this.url = url;
    this.body = body;
    this.hint = hint ?? statusHint(status);
    this.unauthorized = status === 401;
  }
}

function extractDetail(body) {
  if (!body || typeof body !== "object") return "";
  if (typeof body.detail === "string") return body.detail;
  if (body.detail && typeof body.detail.message === "string") return body.detail.message;
  if (typeof body.message === "string") return body.message;
  if (typeof body.error === "string") return body.error;
  return "";
}

async function fetchBody(url, headers) {
  let res;
  try {
    res = await transport(url, { headers });
  } catch (cause) {
    throw new Error(`Network error reaching ${url}: ${cause.message}`);
  }
  const text = await res.text();
  let body;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!res.ok) {
    throw new ApiError({ status: res.status, url, body });
  }
  return body;
}

export async function search({ deviceId, language, credentials, baseUrl, ...opts } = {}) {
  return fetchBody(searchUrl({ baseUrl, ...opts }), buildHeaders({ deviceId, language, credentials }));
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

export async function home({ deviceId, language, credentials, baseUrl = BASE_URL } = {}) {
  return fetchBody(new URL(HOME_PATH, baseUrl).toString(), buildHeaders({ deviceId, language, credentials }));
}

export async function getPluginDetail(pluginId, { deviceId, language, credentials, baseUrl = BASE_URL } = {}) {
  return fetchBody(pluginDetailUrl(pluginId, baseUrl), buildHeaders({ deviceId, language, credentials }));
}

export async function getConnector(appId, { deviceId, language, credentials, baseUrl, includeActions } = {}) {
  return fetchBody(connectorUrl(appId, { baseUrl, includeActions }), buildHeaders({ deviceId, language, credentials }));
}
