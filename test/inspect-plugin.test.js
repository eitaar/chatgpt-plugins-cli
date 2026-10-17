import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import { _setTransport, ApiError } from "../src/api.js";
import { extractAppIds, looksLikePluginId, normalizePlugin, resolvePlugin } from "../src/inspect-plugin.js";
import { response, transportFor } from "./helpers.js";

const PLUGIN_ID = "plugin_asdk_app_6a69834b831c8191a0281d6aca1722f0";
const APP_ID = "asdk_app_6a69834b831c8191a0281d6aca1722f0";

function searchRow(overrides = {}) {
  return {
    id: PLUGIN_ID,
    name: "app-6a69834b831c8191a0281d6aca1722f0",
    canonical_app_id: APP_ID,
    status: "ENABLED",
    release: {
      display_name: "alphaXiv",
      app_ids: [APP_ID],
      app_manifest: { apps: { [`app-6a69834b831c8191a0281d6aca1722f0`]: { id: APP_ID, required: true } } },
      interface: { developer_name: "alphaXiv", category: "Education & Research" },
    },
    ...overrides,
  };
}

afterEach(() => _setTransport(null));

test("looksLikePluginId detects plugin/plugins prefixes", () => {
  assert.equal(looksLikePluginId("plugin_asdk_app_x"), true);
  assert.equal(looksLikePluginId("plugins_123"), true);
  assert.equal(looksLikePluginId("alphaxiv"), false);
  assert.equal(looksLikePluginId(undefined), false);
});

test("extractAppIds unions app_ids, manifest, and canonical ids", () => {
  const ids = extractAppIds({
    canonical_app_id: "asdk_app_canon",
    connector_id: "asdk_app_conn",
    release: {
      app_ids: ["asdk_app_a", "asdk_app_b"],
      app_manifest: { apps: { "app-key": { id: "asdk_app_manifest" }, bare: {} } },
    },
  });
  assert.deepEqual(new Set(ids), new Set(["asdk_app_a", "asdk_app_b", "asdk_app_manifest", "bare", "asdk_app_canon", "asdk_app_conn"]));
});

test("normalizePlugin tolerates a missing release", () => {
  const p = normalizePlugin({ id: "plugin_x", name: "thing" });
  assert.equal(p.id, "plugin_x");
  assert.equal(p.release.display_name, "thing");
  assert.deepEqual(p.release.app_ids, []);
  assert.equal(p.interface.category, null);
});

test("resolvePlugin by id fetches the detail endpoint", async () => {
  _setTransport(
    transportFor([
      ["/backend-api/ps/plugins/", response({ id: PLUGIN_ID, release: { display_name: "alphaXiv" } })],
    ]),
  );
  const result = await resolvePlugin(PLUGIN_ID);
  assert.equal(result.status, "resolved");
  assert.equal(result.via, "id");
  assert.equal(result.plugin.release.display_name, "alphaXiv");
});

test("resolvePlugin by name uses search then detail", async () => {
  const transport = transportFor([
    ["/backend-anon/ps/plugins/search", response({ plugins: [searchRow()] })],
    ["/backend-api/ps/plugins/", response({ id: PLUGIN_ID, release: { display_name: "alphaXiv", app_ids: [APP_ID] } })],
  ]);
  _setTransport(transport);
  const result = await resolvePlugin("alphaxiv");
  assert.equal(result.status, "resolved");
  assert.equal(result.via, "search");
  assert.equal(result.plugin.id, PLUGIN_ID);
});

test("resolvePlugin flags ambiguous names instead of guessing", async () => {
  _setTransport(
    transportFor([
      [
        "/backend-anon/ps/plugins/search",
        response({
          plugins: [
            searchRow({ id: "plugins_a", release: { display_name: "Slack" } }),
            searchRow({ id: "plugins_b", release: { display_name: "Slack" } }),
          ],
        }),
      ],
    ]),
  );
  const result = await resolvePlugin("slack", { fetchDetail: false });
  assert.equal(result.status, "ambiguous");
  assert.equal(result.candidates.length, 2);
});

test("resolvePlugin reports not_found when nothing matches", async () => {
  _setTransport(transportFor([["/backend-anon/ps/plugins/search", response({ plugins: [] })]]));
  const result = await resolvePlugin("does-not-exist", { fetchDetail: false });
  assert.equal(result.status, "not_found");
});

test("resolvePlugin falls back to search row when detail fetch fails", async () => {
  _setTransport(
    transportFor([
      ["/backend-anon/ps/plugins/search", response({ plugins: [searchRow()] })],
      ["/backend-api/ps/plugins/", response({ detail: "boom" }, { status: 500 })],
    ]),
  );
  const result = await resolvePlugin("alphaxiv");
  assert.equal(result.status, "resolved");
  assert.ok(result.detailError instanceof ApiError);
  assert.equal(result.plugin.id, PLUGIN_ID);
});

test("network failure surfaces a clear error", async () => {
  _setTransport(transportFor([["/backend-anon/ps/plugins/search", () => new Error("getaddrinfo ENOTFOUND")]]));
  await assert.rejects(() => resolvePlugin("alphaxiv"), /Network error reaching/);
});

test("ApiError carries status, hint and a parsed detail message", async () => {
  _setTransport(transportFor([["/backend-api/ps/plugins/", response({ detail: { message: "Unauthorized - Access token is missing" } }, { status: 401 })]]));
  await assert.rejects(
    () => resolvePlugin(PLUGIN_ID),
    (err) => {
      assert.equal(err.status, 401);
      assert.equal(err.unauthorized, true);
      assert.match(err.message, /Access token is missing/);
      assert.match(err.hint, /authentication required/);
      return true;
    },
  );
});
