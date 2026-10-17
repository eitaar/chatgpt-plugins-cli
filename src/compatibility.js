// Classifies connector metadata without ever claiming a live connection worked.
// Metadata says what *should* be possible; it never proves a connection.

export const ASSESSMENT_STATES = ["candidate", "requires_verification", "unsupported", "unknown"];

function firstString(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function lower(...values) {
  const value = firstString(...values);
  return value ? value.toLowerCase() : null;
}

function asArray(value) {
  if (Array.isArray(value)) return value.filter((v) => v != null);
  if (value == null) return [];
  return [value];
}

function strings(value) {
  return asArray(value).filter((v) => typeof v === "string" && v.trim()).map((v) => v.trim());
}

// ---------------------------------------------------------------------------
// Connector normalization (defensive: internal shape varies between connectors)
// ---------------------------------------------------------------------------

export function normalizeConnector(raw) {
  if (raw == null || typeof raw !== "object") return null;

  const service = lower(raw.service, raw.service_name, raw.provider, raw.name);
  const name = firstString(raw.display_name, raw.name, raw.service, raw.provider, raw.id);
  const baseUrl = firstString(raw.base_url, raw.baseUrl, raw.url, raw.endpoint, raw.server_url);
  const connectorTypeRaw = firstString(raw.connector_type, raw.type, raw.kind);

  const mcp = normalizeMcp(raw);
  const openapi = normalizeOpenApi(raw);
  const oauth = normalizeOAuth(raw);
  const apiKey = normalizeApiKey(raw);

  const keywords = new Set(
    strings([raw.keywords, raw.capabilities, raw.tags, raw.labels].flat()).map((k) => k.toLowerCase()),
  );

  return {
    id: firstString(raw.id, raw.connector_id, raw.app_id),
    name,
    service,
    connectorTypeRaw,
    baseUrl,
    description: firstString(raw.description, raw.short_description),
    keywords: [...keywords],
    mcp,
    openapi,
    oauth,
    apiKey,
    raw,
  };
}

function normalizeMcp(raw) {
  const mcp = raw.mcp ?? raw.mcp_config ?? {};
  const transport = lower(mcp.transport, raw.mcp_transport, raw.transport);
  const endpoint = firstString(
    mcp.endpoint,
    mcp.url,
    mcp.server_url,
    raw.mcp_endpoint,
    raw.mcp_url,
    raw.server_url,
    mcp.resource,
  );
  const isMcp = Boolean(
    transport?.includes("mcp") ||
      firstString(raw.connector_type, raw.type)?.toLowerCase().includes("mcp") ||
      endpoint,
  );
  return {
    isMcp,
    endpoint: endpoint ?? null,
    transport: transport ?? null,
    requiresLocalExecutor: Boolean(raw.requires_local_executor ?? raw.local_executor ?? false),
  };
}

function normalizeOpenApi(raw) {
  const specUrl = firstString(
    raw.openapi_url,
    raw.openapi?.url,
    raw.openapi_spec_url,
    raw.api_manifest_url,
    raw.spec_url,
    raw.schema_url,
  );
  const apiType = lower(raw.api_type, raw.openapi?.type, raw.protocol);
  const actions = Array.isArray(raw.actions) ? raw.actions : [];
  const hasActions = actions.length > 0;
  const isOpenApi = Boolean(specUrl || apiType?.includes("openapi") || apiType?.includes("rest") || hasActions);
  return { isOpenApi, specUrl: specUrl ?? null, apiType: apiType ?? null, actionCount: actions.length, actions };
}

function normalizeOAuth(raw) {
  const oauth = raw.oauth ?? raw.oauth2 ?? raw.authorization ?? raw.auth?.oauth ?? {};
  const auth = raw.supported_auth ?? raw.auth?.supported_auth ?? raw.auth_types ?? raw.authentication;

  // supported_auth may be a string, "oauth" entry list, or objects.
  let supportedAuth = [];
  if (typeof auth === "string") supportedAuth = [auth];
  else if (Array.isArray(auth)) {
    supportedAuth = auth.map((entry) => (typeof entry === "string" ? entry : entry?.type ?? entry?.name)).filter(Boolean);
  }
  supportedAuth = supportedAuth.map((s) => String(s).toLowerCase());

  const authorizationUrl = firstString(
    oauth.authorization_url,
    oauth.authorize_url,
    oauth.auth_url,
    raw.authorization_url,
    raw.oauth_authorization_url,
  );
  const tokenUrl = firstString(oauth.token_url, oauth.access_token_url, raw.token_url, raw.oauth_token_url);
  const registrationUrl = firstString(
    oauth.registration_url,
    oauth.registration_endpoint,
    oauth.dynamic_client_registration_url,
    raw.registration_url,
    raw.oauth_registration_url,
  );
  const issuerUrl = firstString(oauth.issuer, oauth.issuer_url, oauth.discovery_url, raw.issuer, raw.oidc_discovery_url);
  const scopes = normalizeScopes(oauth.scopes ?? oauth.scope ?? raw.scopes ?? raw.oauth_scopes);

  const pkceRequired = Boolean(oauth.pkce_required ?? oauth.requires_pkce ?? raw.pkce_required ?? false);
  const pkceMethod = firstString(oauth.pkce_method, oauth.code_challenge_method, raw.pkce_method);
  const pkce = pkceRequired || Boolean(pkceMethod);

  const clientAuthMethods = strings(
    oauth.token_endpoint_auth_methods_supported ??
      oauth.token_endpoint_auth_method ??
      oauth.client_auth_methods ??
      raw.token_endpoint_auth_methods_supported,
  );

  const hasOauth = Boolean(
    authorizationUrl ||
      tokenUrl ||
      registrationUrl ||
      supportedAuth.some((s) => s.includes("oauth")) ||
      Object.keys(oauth).length > 0,
  );

  return {
    isOauth: hasOauth,
    authorizationUrl: authorizationUrl ?? null,
    tokenUrl: tokenUrl ?? null,
    registrationUrl: registrationUrl ?? null,
    issuerUrl: issuerUrl ?? null,
    scopes,
    pkce,
    pkceRequired,
    pkceMethod: pkceMethod ?? (pkceRequired ? "S256" : null),
    clientAuthMethods,
    supportedAuth,
  };
}

function normalizeScopes(scopes) {
  if (scopes == null) return [];
  if (typeof scopes === "string") {
    return scopes.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);
  }
  if (Array.isArray(scopes)) {
    return scopes
      .map((s) => (typeof s === "string" ? s : s?.scope ?? s?.name))
      .filter(Boolean)
      .map((s) => String(s).trim());
  }
  if (typeof scopes === "object") return Object.keys(scopes);
  return [];
}

function normalizeApiKey(raw) {
  const key = raw.api_key ?? raw.auth?.api_key ?? {};
  const supportedAuth = normalizeOAuth(raw).supportedAuth;
  const isApiKey = Boolean(firstString(key.name, key.header, key.location) || supportedAuth.includes("api_key"));
  return { isApiKey, location: firstString(key.location, key.in) ?? null, name: firstString(key.name, key.header) ?? null };
}

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

export const CLASSIFICATION = {
  MCP: "mcp",
  REST_OPENAPI: "rest-openapi",
  AGENT_PLUGIN: "agent-plugin",
  CHATGPT_SPECIFIC: "chatgpt-specific",
  UNKNOWN: "unknown",
};

export function classifyConnector(connector, plugin) {
  if (!connector) return { type: CLASSIFICATION.UNKNOWN, reasons: ["no connector metadata available"] };

  const reasons = [];
  const { mcp, openapi, oauth, apiKey } = connector;

  if (mcp.isMcp) {
    if (mcp.endpoint) reasons.push(`MCP endpoint advertised (${mcp.endpoint})`);
    if (mcp.transport) reasons.push(`MCP transport: ${mcp.transport}`);
    if (mcp.requiresLocalExecutor) reasons.push("requires a local executor");
    return { type: CLASSIFICATION.MCP, reasons };
  }
  if (openapi.isOpenApi) {
    if (openapi.specUrl) reasons.push(`OpenAPI/REST spec advertised (${openapi.specUrl})`);
    if (openapi.actionCount) reasons.push(`${openapi.actionCount} action(s) declared`);
    return { type: CLASSIFICATION.REST_OPENAPI, reasons };
  }
  if (oauth.isOauth || apiKey.isApiKey) {
    reasons.push("auth metadata present but no external protocol endpoint advertised");
    return { type: CLASSIFICATION.CHATGPT_SPECIFIC, reasons };
  }

  const hasSkills = (plugin?.release?.skills ?? []).length > 0 || Boolean(plugin?.release?.onboarding_skill_name);
  if (hasSkills) {
    reasons.push("packaged skills present, no external endpoint advertised");
    return { type: CLASSIFICATION.AGENT_PLUGIN, reasons };
  }
  reasons.push("no recognizable protocol or auth metadata");
  return { type: CLASSIFICATION.UNKNOWN, reasons };
}

// ---------------------------------------------------------------------------
// Compatibility assessment
// ---------------------------------------------------------------------------

export function assessCompatibility(connector, plugin, options = {}) {
  const metadata = assessMetadata(connector, plugin, options);
  const authentication = assessAuthentication(connector);
  const protocol = assessProtocol(connector, plugin, options);

  const independentClient = deriveIndependentClient(metadata, authentication, protocol);

  return { metadata, authentication, protocol, independentClient };
}

function assessMetadata(connector, plugin, options) {
  const sources = {
    plugin: Boolean(plugin),
    pluginLive: options.pluginSource === "live",
    connector: Boolean(connector),
    connectorLive: options.connectorSource === "live",
    connectorOffline: options.connectorSource === "file",
  };
  const available = Boolean(plugin || connector);
  const notes = [];
  if (!connector) notes.push("connector metadata unavailable (endpoint requires authentication)");
  if (plugin && !connector) notes.push("plugin metadata alone does not describe the external service protocol");
  return { available, sources, notes };
}

function assessAuthentication(connector) {
  if (!connector) {
    return { type: "unknown", oauth: null, reasons: ["no connector metadata to inspect"] };
  }
  const { oauth, apiKey, keywords } = connector;
  const reasons = [];
  let type = "unknown";

  if (oauth.isOauth) {
    type = "oauth";
    if (oauth.authorizationUrl) reasons.push(`authorization URL: ${oauth.authorizationUrl}`);
    if (oauth.tokenUrl) reasons.push(`token URL: ${oauth.tokenUrl}`);
    if (oauth.registrationUrl) reasons.push(`registration URL advertised: ${oauth.registrationUrl}`);
    else reasons.push("no registration URL advertised");
    if (oauth.pkce) reasons.push(`PKCE: ${oauth.pkceMethod ?? "required"}`);
    if (oauth.scopes.length) reasons.push(`scopes: ${oauth.scopes.join(", ")}`);
    if (oauth.clientAuthMethods.length) reasons.push(`client auth methods: ${oauth.clientAuthMethods.join(", ")}`);
  } else if (apiKey.isApiKey) {
    type = "api_key";
    reasons.push("API key authentication advertised");
  } else if (keywords.some((k) => k.includes("oauth"))) {
    type = "oauth";
    reasons.push("oauth keyword present but no URL fields");
  } else {
    reasons.push("supported authentication methods not advertised");
  }

  return { type, oauth, apiKey, reasons };
}

function assessProtocol(connector, plugin, options) {
  const classification = classifyConnector(connector, plugin);
  const { mcp } = connector ?? {};
  const endpoint = mcp?.endpoint ?? connector?.openapi?.specUrl ?? null;
  return {
    classification: classification.type,
    endpoint: endpoint ?? null,
    requiresLocalExecutor: Boolean(mcp?.requiresLocalExecutor),
    externallyReachable: null, // never established from metadata
    reasons: classification.reasons,
  };
}

function deriveIndependentClient(metadata, authentication, protocol) {
  const reasons = [];

  if (!metadata.available) {
    return { state: "unknown", reasons: ["no metadata available to assess"] };
  }
  if (!metadata.sources.connector) {
    return {
      state: "requires_verification",
      reasons: ["plugin metadata available but connector metadata missing; cannot assess protocol"],
    };
  }

  const isExternalProtocol = protocol.classification === CLASSIFICATION.MCP || protocol.classification === CLASSIFICATION.REST_OPENAPI;

  if (protocol.requiresLocalExecutor) {
    return {
      state: "unsupported",
      reasons: ["connector requires a local executor; an independent harness cannot host it"],
    };
  }

  if (!isExternalProtocol) {
    if (protocol.classification === CLASSIFICATION.UNKNOWN) {
      return { state: "unknown", reasons: ["no recognizable protocol in the connector metadata"] };
    }
    // Auth metadata exists but no externally reachable protocol was identified.
    return {
      state: "requires_verification",
      reasons: [`no independently reachable protocol identified (classified ${protocol.classification})`],
    };
  }

  // External protocol, no auth at all -> candidate (rare, but possible).
  if (authentication.type === "unknown") {
    return {
      state: "requires_verification",
      reasons: [`${protocol.classification} endpoint identified but authentication model is unclear`],
    };
  }

  if (authentication.type === "oauth") {
    const oauth = authentication.oauth ?? {};
    if (oauth.registrationUrl && oauth.authorizationUrl && oauth.tokenUrl) {
      reasons.push("standard OAuth endpoints and a registration URL are advertised");
      reasons.push("an independent client could in principle register and connect, but this is unverified");
      return { state: "candidate", reasons };
    }
    if (oauth.authorizationUrl && oauth.tokenUrl) {
      reasons.push("OAuth endpoints advertised but no dynamic registration URL");
      reasons.push("independent connection would need pre-issued client credentials");
      return { state: "requires_verification", reasons };
    }
    return { state: "requires_verification", reasons: ["OAuth indicated but endpoint coverage is incomplete"] };
  }

  if (authentication.type === "api_key") {
    reasons.push("API key auth plus an external protocol endpoint");
    reasons.push("independent connection needs the user to supply their own key; unverified");
    return { state: "requires_verification", reasons };
  }

  return { state: "requires_verification", reasons: ["external protocol identified; connection not verified"] };
}

// Convenience: does the metadata advertise dynamic client registration?
export function supportsIndependentRegistration(connector) {
  const oauth = connector?.oauth;
  return Boolean(oauth?.registrationUrl || oauth?.clientAuthMethods?.includes("none"));
}

export function independentConnectionReport(connector, plugin, options) {
  return {
    classification: classifyConnector(connector, plugin),
    assessment: assessCompatibility(connector, plugin, options),
    registration: {
      advertised: supportsIndependentRegistration(connector),
      registrationUrl: connector?.oauth?.registrationUrl ?? null,
    },
    liveConnectionTested: false,
    liveConnectionNote: "This tool never initiates an OAuth login or MCP connection; live connectivity is untested.",
  };
}
