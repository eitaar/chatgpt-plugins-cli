import { readFileSync } from "node:fs";

import { ApiError, getConnector } from "./api.js";
import { extractAppIds, normalizePlugin, resolvePlugin } from "./inspect-plugin.js";
import { independentConnectionReport, normalizeConnector } from "./compatibility.js";

function readJsonFile(path) {
  let text;
  try {
    text = readFileSync(path, "utf8");
  } catch (cause) {
    throw new Error(`could not read ${path}: ${cause.message}`);
  }
  try {
    return JSON.parse(text);
  } catch (cause) {
    throw new Error(`invalid JSON in ${path}: ${cause.message}`);
  }
}

// Pull the plugin object out of whatever the user saved (a search response,
// a detail response, or the bare plugin object).
function pickPlugin(raw) {
  if (!raw || typeof raw !== "object") return null;
  if (raw.plugin && typeof raw.plugin === "object") return raw.plugin;
  if (Array.isArray(raw.plugins)) return raw.plugins[0] ?? null;
  return raw;
}

function pickConnector(raw) {
  if (!raw || typeof raw !== "object") return null;
  if (raw.connector && typeof raw.connector === "object") return raw.connector;
  return raw;
}

export function pluginIdFromInput(input) {
  const candidate = pickPlugin(input);
  return candidate?.id ?? null;
}

// The single entry point. Everything it returns is safe to JSON.stringify.
export async function inspect(target, options = {}) {
  const {
    pluginJson,
    connectorJson,
    includeActions = false,
    searchLimit = 16,
    fetchImpl = getConnector,
    offline = false,
    ...ctx
  } = options;

  const warnings = [];
  let plugin = null;
  let pluginRaw = null;
  let pluginSource = "none";
  let resolution = null;

  if (pluginJson) {
    pluginRaw = pickPlugin(readJsonFile(pluginJson));
    plugin = normalizePlugin(pluginRaw);
    pluginSource = "file";
  } else if (target) {
    resolution = await resolvePlugin(target, { searchLimit, ...ctx });
    if (resolution.plugin) {
      plugin = resolution.plugin;
      pluginRaw = resolution.raw;
      pluginSource = "live";
      if (resolution.detailError) {
        warnings.push(`plugin detail fetch failed (${resolution.detailError.message}); used search metadata`);
      }
    }
  }

  let connector = null;
  let connectorSource = "none";
  let connectorError = null;

  if (connectorJson) {
    connector = normalizeConnector(pickConnector(readJsonFile(connectorJson)));
    connectorSource = "file";
  }

  const appIds = plugin ? extractAppIds(pluginRaw ?? plugin) : [];

  if (!connector && !connectorJson && !offline) {
    const appId = appIds[0];
    if (appId) {
      try {
        const raw = await fetchImpl(appId, { includeActions, ...ctx });
        connector = normalizeConnector(pickConnector(raw));
        connectorSource = "live";
      } catch (err) {
        const authGated = err instanceof ApiError && (err.status === 401 || err.status === 403);
        connectorError = {
          status: err instanceof ApiError ? err.status : null,
          accessGated: authGated,
          message: err.message,
          hint: err.hint ?? null,
        };
        warnings.push(
          authGated
            ? "connector metadata is access-gated (authentication required); supply --connector-json or --token"
            : `connector fetch failed: ${err.message}`,
        );
      }
    }
  }

  const report = independentConnectionReport(connector, plugin, { pluginSource, connectorSource });

  const assessment = buildAssessmentText({ plugin, connector, report, connectorError });

  return {
    schemaVersion: "1.0",
    generatedAt: new Date().toISOString(),
    experimental: true,
    target: target ?? null,
    resolution: resolution
      ? {
          status: resolution.status,
          via: resolution.via,
          candidates: (resolution.candidates ?? []).map((c) => ({
            id: c.id,
            display_name: c.release?.display_name ?? c.display_name ?? c.name ?? null,
          })),
        }
      : null,
    plugin: plugin
      ? {
          id: plugin.id,
          display_name: plugin.release.display_name,
          app_ids: appIds,
          status: plugin.status,
          category: plugin.interface.category,
          developer_name: plugin.interface.developer_name,
        }
      : null,
    sources: { plugin: pluginSource, connector: connectorSource },
    connector: connector
      ? {
          id: connector.id,
          name: connector.name,
          service: connector.service,
          connectorType: connector.connectorTypeRaw,
          base_url: connector.baseUrl,
          keywords: connector.keywords,
        }
      : null,
    connection: {
      type: report.classification.type,
      endpoint: report.assessment.protocol.endpoint,
      reasons: report.classification.reasons,
    },
    authentication: {
      type: report.assessment.authentication.type,
      authorizationUrl: connector?.oauth.authorizationUrl ?? null,
      tokenUrl: connector?.oauth.tokenUrl ?? null,
      registrationUrl: connector?.oauth.registrationUrl ?? null,
      issuerUrl: connector?.oauth.issuerUrl ?? null,
      scopes: connector?.oauth.scopes ?? [],
      pkce: connector?.oauth.pkce ?? false,
      pkceMethod: connector?.oauth.pkceMethod ?? null,
      clientAuthMethods: connector?.oauth.clientAuthMethods ?? [],
      reasons: report.assessment.authentication.reasons,
    },
    compatibility: report.assessment,
    registration: report.registration,
    liveConnection: {
      tested: false,
      state: "not_tested",
      note: report.liveConnectionNote,
    },
    assessmentText: assessment,
    warnings,
    errors: connectorError ? [connectorError] : [],
  };
}

function buildAssessmentText({ plugin, connector, report, connectorError }) {
  const lines = [];
  const { classification } = report;
  const { authentication, protocol } = report.assessment;

  if (!connector) {
    lines.push("No connector metadata was available, so the external protocol and authentication cannot be determined.");
    if (connectorError?.accessGated) {
      lines.push("The connector endpoint is access-gated (experimental internal API) and requires an authenticated access token.");
      lines.push("Re-run with --connector-json <file> using metadata you obtained yourself, or pass your own --token.");
    } else if (connectorError) {
      lines.push(`Connector lookup failed: ${connectorError.message}`);
    }
    return lines.join(" ");
  }

  if (classification.type === "mcp") {
    lines.push("The connector metadata describes an MCP endpoint.");
  } else if (classification.type === "rest-openapi") {
    lines.push("The connector metadata describes a REST/OpenAPI service.");
  } else {
    lines.push(`The connector classifies as "${classification.type}".`);
  }

  if (authentication.type === "oauth") {
    lines.push(connector.oauth.registrationUrl ? "An OAuth registration mechanism is advertised." : "OAuth is used without an advertised registration URL.");
  } else if (authentication.type === "api_key") {
    lines.push("API key authentication is advertised.");
  }

  const verdict = report.assessment.independentClient.state;
  const phrase = {
    candidate: "Independent connection appears plausible but has not been verified.",
    requires_verification: "Independent connection may be possible but requires verification.",
    unsupported: "Independent connection is not supported by this metadata.",
    unknown: "Independent connection cannot be assessed from this metadata.",
  }[verdict];
  lines.push(phrase);
  return lines.join(" ");
}
