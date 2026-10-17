import { test, afterEach } from "node:test";
import assert from "node:assert/strict";

import { _setTransport } from "../src/api.js";
import { inspect } from "../src/inspect.js";
import { response, transportFor } from "./helpers.js";

const PLUGIN_ID = "plugin_asdk_app_6a69834b831c8191a0281d6aca1722f0";
const APP_ID = "asdk_app_6a69834b831c8191a0281d6aca1722f0";

function pluginDetail(overrides = {}) {
  return {
    id: PLUGIN_ID,
    canonical_app_id: APP_ID,
    status: "ENABLED",
    release: {
      display_name: "alphaXiv",
      app_ids: [APP_ID],
      app_manifest: { apps: { [`app-x`]: { id: APP_ID, required: true } } },
      interface: { developer_name: "alphaXiv", category: "Education & Research" },
    },
    ...overrides,
  };
}

afterEach(() => _setTransport(null));

test("live inspect resolves plugin and connector end to end", async () => {
  _setTransport(
    transportFor([
      ["/backend-api/aip/connectors/", response({ connector_type: "mcp", mcp: { endpoint: "https://api.alphaxiv.org/mcp/v1" }, oauth: { authorization_url: "https://a", token_url: "https://t", registration_url: "https://r", scopes: ["email"] } })],
      ["/backend-anon/ps/plugins/search", response({ plugins: [pluginDetail()] })],
      ["/backend-api/ps/plugins/", response(pluginDetail())],
    ]),
  );
  const report = await inspect("alphaxiv");
  assert.equal(report.plugin.id, PLUGIN_ID);
  assert.deepEqual(report.plugin.app_ids, [APP_ID]);
  assert.equal(report.sources.connector, "live");
  assert.equal(report.connection.type, "mcp");
  assert.equal(report.authentication.type, "oauth");
  assert.equal(report.compatibility.independentClient.state, "candidate");
  assert.equal(report.liveConnection.tested, false);
  assert.equal(report.experimental, true);
});

test("live inspect by plugin id works", async () => {
  _setTransport(
    transportFor([
      ["/backend-api/aip/connectors/", response({ connector_type: "mcp", mcp: { endpoint: "https://x/mcp" } })],
      ["/backend-api/ps/plugins/", response(pluginDetail())],
    ]),
  );
  const report = await inspect(PLUGIN_ID);
  assert.equal(report.resolution.via, "id");
  assert.equal(report.plugin.id, PLUGIN_ID);
});

test("connector 401 marks auth required and keeps plugin metadata", async () => {
  _setTransport(
    transportFor([
      ["/backend-api/aip/connectors/", response({ detail: { message: "Unauthorized - Access token is missing" } }, { status: 401 })],
      ["/backend-api/ps/plugins/", response(pluginDetail())],
    ]),
  );
  const report = await inspect(PLUGIN_ID);
  assert.equal(report.sources.connector, "none");
  assert.equal(report.errors[0].status, 401);
  assert.equal(report.errors[0].accessGated, true);
  assert.equal(report.compatibility.independentClient.state, "requires_verification");
  assert.match(report.warnings.join(" "), /access-gated/);
  assert.match(report.assessmentText, /access-gated/);
});

test("connector 403 (Cloudflare/auth gate) is treated as access-gated", async () => {
  _setTransport(
    transportFor([
      ["/backend-api/aip/connectors/", response("<html>challenge</html>", { status: 403 })],
      ["/backend-api/ps/plugins/", response(pluginDetail())],
    ]),
  );
  const report = await inspect(PLUGIN_ID);
  assert.equal(report.errors[0].status, 403);
  assert.equal(report.errors[0].accessGated, true);
  assert.match(report.assessmentText, /access-gated/);
});

test("unreachable connector (network error) is reported without throwing", async () => {
  _setTransport(
    transportFor([
      ["/backend-api/aip/connectors/", () => new Error("connect ECONNREFUSED")],
      ["/backend-api/ps/plugins/", response(pluginDetail())],
    ]),
  );
  const report = await inspect(PLUGIN_ID);
  assert.equal(report.sources.connector, "none");
  assert.equal(report.errors[0].status, null);
  assert.match(report.warnings.join(" "), /connector fetch failed/);
});

test("offline inspect reads plugin and connector JSON files", async () => {
  const report = await inspect(undefined, {
    pluginJson: "test/fixtures/plugin-alphaxiv.json",
    connectorJson: "test/fixtures/connector-mcp-oauth.json",
    offline: true,
  });
  assert.equal(report.sources.plugin, "file");
  assert.equal(report.sources.connector, "file");
  assert.equal(report.connection.type, "mcp");
  assert.equal(report.registration.advertised, true);
  assert.equal(report.compatibility.independentClient.state, "candidate");
});

test("offline connector-only inspection still assesses compatibility", async () => {
  const report = await inspect(undefined, {
    connectorJson: "test/fixtures/connector-rest-apikey.json",
    offline: true,
  });
  assert.equal(report.plugin, null);
  assert.equal(report.connection.type, "rest-openapi");
  assert.equal(report.compatibility.independentClient.state, "requires_verification");
});

test("a search response file (multiple plugins) selects the first plugin", async () => {
  const report = await inspect(undefined, {
    pluginJson: "test/fixtures/search-alphaxiv.json",
    connectorJson: "test/fixtures/connector-mcp-oauth.json",
    offline: true,
  });
  assert.equal(report.plugin.id, PLUGIN_ID);
});

test("missing offline file produces a clear error", async () => {
  await assert.rejects(() => inspect(undefined, { pluginJson: "test/fixtures/nope.json", offline: true }), /could not read/);
});

test("malformed offline JSON produces a clear error", async () => {
  await assert.rejects(() => inspect(undefined, { connectorJson: "test/fixtures/connector-broken.json", offline: true }), /invalid JSON/);
});

test("multi-app plugin reports every app id", async () => {
  const detail = pluginDetail({
    release: {
      display_name: "Multi",
      app_ids: ["asdk_app_a", "asdk_app_b"],
      app_manifest: { apps: { a: { id: "asdk_app_a" }, b: { id: "asdk_app_b" } } },
      interface: {},
    },
  });
  _setTransport(
    transportFor([
      ["/backend-api/aip/connectors/asdk_app_a", response({ connector_type: "mcp", mcp: { endpoint: "https://a/mcp" } })],
      ["/backend-api/ps/plugins/", response(detail)],
    ]),
  );
  const report = await inspect(PLUGIN_ID);
  // app_ids come from release.app_ids/manifest, plus canonical_app_id/connector_id fallbacks
  assert.deepEqual(report.plugin.app_ids, ["asdk_app_a", "asdk_app_b", APP_ID]);
  assert.equal(report.sources.connector, "live");
});

test("not_found resolution is surfaced in the report", async () => {
  _setTransport(transportFor([["/backend-anon/ps/plugins/search", response({ plugins: [] })]]));
  const report = await inspect("does-not-exist");
  assert.equal(report.resolution.status, "not_found");
  assert.equal(report.plugin, null);
});
