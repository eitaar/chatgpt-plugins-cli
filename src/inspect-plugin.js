import { getPluginDetail, search, ApiError } from "./api.js";

export const PLUGIN_ID_RE = /^(plugin_|plugins_)/;

export function looksLikePluginId(value) {
  return PLUGIN_ID_RE.test(String(value ?? ""));
}

export function normalizePlugin(raw) {
  const release = raw?.release ?? {};
  const iface = release.interface ?? {};
  const manifest = release.app_manifest ?? {};
  return {
    id: raw?.id ?? null,
    name: raw?.name ?? null,
    canonical_app_id: raw?.canonical_app_id ?? null,
    connector_id: raw?.connector_id ?? null,
    status: raw?.status ?? null,
    discoverability: raw?.discoverability ?? null,
    authentication_policy: raw?.authentication_policy ?? null,
    scope: raw?.scope ?? null,
    release: {
      id: release.id ?? null,
      version: release.version ?? null,
      display_name: release.display_name ?? raw?.display_name ?? raw?.name ?? null,
      description: release.description ?? null,
      requires_local_executor: release.requires_local_executor ?? null,
      keywords: release.keywords ?? [],
      bundle_download_url: release.bundle_download_url ?? null,
      app_ids: release.app_ids ?? [],
      app_manifest: manifest,
      skills: release.skills ?? [],
      onboarding_skill_name: release.onboarding_skill_name ?? null,
    },
    interface: {
      short_description: iface.short_description ?? null,
      long_description: iface.long_description ?? null,
      developer_name: iface.developer_name ?? null,
      category: iface.category ?? null,
      plugin_category_id: iface.plugin_category_id ?? null,
      capabilities: iface.capabilities ?? [],
      website_url: iface.website_url ?? null,
      privacy_policy_url: iface.privacy_policy_url ?? null,
      terms_of_service_url: iface.terms_of_service_url ?? null,
    },
    share_url: raw?.share_url ?? null,
    creator_name: raw?.creator_name ?? null,
  };
}

// Union of release.app_ids and the keys/ids inside release.app_manifest.apps.
export function extractAppIds(plugin) {
  const ids = new Set();
  for (const id of plugin?.release?.app_ids ?? []) {
    if (id) ids.add(id);
  }
  const apps = plugin?.release?.app_manifest?.apps;
  if (apps && typeof apps === "object") {
    for (const [key, value] of Object.entries(apps)) {
      const id = value?.id ?? key;
      if (id) ids.add(id);
    }
  }
  for (const key of ["canonical_app_id", "connector_id"]) {
    if (plugin?.[key]) ids.add(plugin[key]);
  }
  return [...ids];
}

function matchScore(plugin, query) {
  const display = (plugin.release?.display_name ?? "").toLowerCase();
  const name = (plugin.name ?? "").toLowerCase();
  const q = query.toLowerCase();
  if (display === q || name === q) return 3;
  if (display.startsWith(q) || name.startsWith(q)) return 2;
  if (display.includes(q) || name.includes(q)) return 1;
  return 0;
}

// Resolve a plugin by exact ID or by name via search. Never silently guesses
// when the name is ambiguous: status "ambiguous" carries the candidates.
export async function resolvePlugin(input, { fetchDetail = true, searchLimit = 16, ...ctx } = {}) {
  if (looksLikePluginId(input)) {
    if (!fetchDetail) return { status: "resolved", plugin: null, candidates: [], via: "id" };
    const detail = await getPluginDetail(input, ctx);
    return { status: "resolved", plugin: normalizePlugin(detail), raw: detail, candidates: [], via: "id" };
  }

  const res = await search({ query: input, limit: searchLimit, ...ctx });
  const plugins = res.plugins ?? [];
  const scored = plugins
    .map((plugin, index) => ({ plugin, index, score: matchScore(plugin, input) }))
    .sort((a, b) => b.score - a.score || a.index - b.index);
  const best = scored[0];

  if (!best || best.score < 1) {
    return { status: "not_found", plugin: null, raw: null, candidates: plugins, via: "search" };
  }
  const ties = scored.filter((s) => s.score === best.score);
  if (ties.length > 1) {
    return {
      status: "ambiguous",
      plugin: null,
      raw: null,
      via: "search",
      candidates: ties.map((t) => t.plugin),
    };
  }

  const chosen = best.plugin;
  if (!fetchDetail) {
    return { status: "resolved", plugin: normalizePlugin(chosen), raw: chosen, candidates: plugins, via: "search" };
  }
  try {
    const detail = await getPluginDetail(chosen.id, ctx);
    return { status: "resolved", plugin: normalizePlugin(detail), raw: detail, candidates: plugins, via: "search" };
  } catch (err) {
    if (err instanceof ApiError) {
      // Fall back to the search row so we still report what we know.
      return { status: "resolved", plugin: normalizePlugin(chosen), raw: chosen, candidates: plugins, via: "search", detailError: err };
    }
    throw err;
  }
}
