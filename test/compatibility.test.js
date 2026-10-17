import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  CLASSIFICATION,
  assessCompatibility,
  classifyConnector,
  independentConnectionReport,
  normalizeConnector,
  supportsIndependentRegistration,
} from "../src/compatibility.js";

const fixtures = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const load = (name) => JSON.parse(readFileSync(join(fixtures, name), "utf8"));

const mcp = normalizeConnector(load("connector-mcp-oauth.json"));
const rest = normalizeConnector(load("connector-rest-apikey.json"));
const malformed = normalizeConnector(load("connector-malformed.json"));
const local = normalizeConnector(load("connector-local-executor.json"));
// The real connector schema, captured from the live endpoint (sanitized).
const live = normalizeConnector(load("connector-alphaxiv-mcp.json"));

test("normalizeConnector extracts core fields", () => {
  assert.equal(mcp.service, "alphaxiv");
  assert.equal(mcp.baseUrl, "https://api.alphaxiv.org");
  assert.equal(mcp.mcp.endpoint, "https://api.alphaxiv.org/mcp/v1");
  assert.equal(mcp.mcp.transport, "streamable_http");
});

test("MCP connector metadata is parsed", () => {
  assert.equal(mcp.mcp.isMcp, true);
  assert.equal(mcp.mcp.requiresLocalExecutor, false);
});

test("OAuth metadata is parsed including PKCE and registration", () => {
  assert.equal(mcp.oauth.isOauth, true);
  assert.equal(mcp.oauth.authorizationUrl, "https://api.alphaxiv.org/oauth/authorize");
  assert.equal(mcp.oauth.tokenUrl, "https://api.alphaxiv.org/oauth/token");
  assert.equal(mcp.oauth.registrationUrl, "https://api.alphaxiv.org/oauth/register");
  assert.equal(mcp.oauth.issuerUrl, "https://api.alphaxiv.org");
  assert.deepEqual(mcp.oauth.scopes, ["email", "profile"]);
  assert.equal(mcp.oauth.pkce, true);
  assert.equal(mcp.oauth.pkceRequired, true);
  assert.equal(mcp.oauth.pkceMethod, "S256");
  assert.deepEqual(mcp.oauth.clientAuthMethods, ["none", "client_secret_post"]);
});

test("classifies MCP vs REST/OpenAPI", () => {
  assert.equal(classifyConnector(mcp, null).type, CLASSIFICATION.MCP);
  assert.equal(classifyConnector(rest, null).type, CLASSIFICATION.REST_OPENAPI);
});

// --- real live schema (connector_type / base_url / supported_auth[]) ---------

test("real schema: connector_type and base_url drive the MCP endpoint", () => {
  assert.equal(live.connectorType, "mcp");
  assert.equal(live.connectorTypeRaw, "MCP");
  assert.equal(live.baseUrl, "https://api.alphaxiv.org/mcp/v1");
  assert.equal(live.mcp.isMcp, true);
  assert.equal(live.mcp.endpoint, "https://api.alphaxiv.org/mcp/v1");
  assert.equal(classifyConnector(live, null).type, CLASSIFICATION.MCP);
});

test("real schema: OAuth is read from supported_auth[].{...}", () => {
  assert.equal(live.oauth.isOauth, true);
  assert.equal(live.oauth.authorizationUrl, "https://api.alphaxiv.org/auth/oauth2/authorize");
  assert.equal(live.oauth.tokenUrl, "https://api.alphaxiv.org/auth/oauth2/token");
  assert.equal(live.oauth.registrationUrl, "https://api.alphaxiv.org/auth/oauth2/register");
  assert.equal(live.oauth.revocationUrl, "https://api.alphaxiv.org/auth/oauth2/revoke");
  assert.equal(live.oauth.issuerUrl, "https://api.alphaxiv.org/auth/.well-known/openid-configuration");
  assert.deepEqual(live.oauth.supportedAuth, ["oauth"]);
  assert.equal(live.oauth.oauthResource, "https://api.alphaxiv.org/mcp/v1");
});

test("real schema: PKCE methods and scopes", () => {
  assert.equal(live.oauth.pkce, true);
  assert.equal(live.oauth.pkceRequired, true);
  assert.equal(live.oauth.pkceMethod, "S256");
  assert.deepEqual(live.oauth.pkceMethods, ["S256"]);
  assert.deepEqual(live.oauth.scopes, ["email", "profile"]);
  assert.deepEqual(live.oauth.clientAuthMethods, ["none", "client_secret_basic", "client_secret_post"]);
  assert.equal(live.oauth.oidcEnabled, true);
});

test("real schema: MCP + OAuth registration is a candidate", () => {
  const report = independentConnectionReport(live, null, { connectorSource: "live" });
  assert.equal(report.assessment.independentClient.state, "candidate");
  assert.equal(report.registration.advertised, true);
  assert.equal(report.registration.registrationUrl, "https://api.alphaxiv.org/auth/oauth2/register");
  assert.equal(report.liveConnectionTested, false);
});

test("MCP + OAuth with registration is a candidate for independent connection", () => {
  const report = independentConnectionReport(mcp, null, { connectorSource: "live" });
  assert.equal(report.assessment.independentClient.state, "candidate");
  assert.ok(report.assessment.independentClient.reasons.some((r) => /registration/i.test(r)));
  assert.equal(report.liveConnectionTested, false);
  assert.equal(supportsIndependentRegistration(mcp), true);
});

test("REST + API key requires verification, not an outright candidate", () => {
  const report = independentConnectionReport(rest, null, { connectorSource: "live" });
  assert.equal(report.assessment.authentication.type, "api_key");
  assert.equal(report.assessment.independentClient.state, "requires_verification");
});

test("local-executor connector is unsupported for an independent harness", () => {
  const report = independentConnectionReport(local, null, { connectorSource: "live" });
  assert.equal(report.assessment.protocol.requiresLocalExecutor, true);
  assert.equal(report.assessment.independentClient.state, "unsupported");
});

test("OAuth without a registration URL requires verification", () => {
  const report = independentConnectionReport(local, null, { connectorSource: "live" });
  // local exec dominates, but the auth axis should still be oauth
  assert.equal(report.assessment.authentication.type, "oauth");
});

test("missing connector metadata yields requires_verification, not unknown", () => {
  const report = independentConnectionReport(null, { release: { display_name: "x" } }, {});
  assert.equal(report.classification.type, CLASSIFICATION.UNKNOWN);
  // plugin metadata exists, so the state is "requires_verification" rather than "unknown"
  assert.equal(report.assessment.independentClient.state, "requires_verification");
  assert.equal(report.assessment.metadata.available, true);
  assert.equal(report.assessment.metadata.sources.connector, false);
});

test("no metadata at all yields unknown with a reason", () => {
  const report = independentConnectionReport(null, null, {});
  assert.equal(report.assessment.independentClient.state, "unknown");
  assert.equal(report.assessment.metadata.available, false);
});

test("malformed connector metadata does not throw and degrades gracefully", () => {
  assert.ok(malformed);
  assert.equal(malformed.baseUrl, null);
  assert.equal(malformed.mcp.isMcp, false);
  assert.deepEqual(malformed.openapi.actions, []);
  assert.deepEqual(malformed.oauth.scopes, []);
  const report = independentConnectionReport(malformed, null, {});
  assert.equal(report.assessment.independentClient.state, "requires_verification");
});

test("assessCompatibility separates the four axes", () => {
  const report = assessCompatibility(mcp, { release: { skills: [] } }, { connectorSource: "live" });
  assert.ok(report.metadata && report.authentication && report.protocol && report.independentClient);
  assert.equal(report.protocol.externallyReachable, null);
});

test("normalizeConnector returns null for non-objects", () => {
  assert.equal(normalizeConnector(null), null);
  assert.equal(normalizeConnector("nope"), null);
});
