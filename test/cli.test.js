import { test, afterEach } from "node:test";
import assert from "node:assert/strict";

import { _setTransport } from "../src/api.js";
import { run } from "../src/cli.js";
import { response, transportFor } from "./helpers.js";

const PLUGIN_ID = "plugin_asdk_app_6a69834b831c8191a0281d6aca1722f0";
const APP_ID = "asdk_app_6a69834b831c8191a0281d6aca1722f0";

function capture() {
  const lines = [];
  return { out: (line) => lines.push(line), text: () => lines.join("\n") };
}

function searchRow() {
  return {
    id: PLUGIN_ID,
    name: "app-x",
    canonical_app_id: APP_ID,
    status: "ENABLED",
    release: {
      display_name: "alphaXiv",
      app_ids: [APP_ID],
      app_manifest: { apps: { x: { id: APP_ID } } },
      interface: { developer_name: "alphaXiv", category: "Education & Research", short_description: "Research papers" },
    },
  };
}

const detail = {
  id: PLUGIN_ID,
  canonical_app_id: APP_ID,
  status: "ENABLED",
  release: {
    display_name: "alphaXiv",
    app_ids: [APP_ID],
    app_manifest: { apps: { x: { id: APP_ID } } },
    interface: { developer_name: "alphaXiv", category: "Education & Research" },
  },
};

afterEach(() => _setTransport(null));

test("regression: search table still renders", async () => {
  _setTransport(transportFor([["/backend-anon/ps/plugins/search", response({ plugins: [searchRow()] })]]));
  const cap = capture();
  const code = await run(["alphaxiv"], cap.out);
  assert.equal(code, 0);
  assert.match(cap.text(), /alphaXiv/);
  assert.match(cap.text(), /1 plugin\(s\)\./);
});

test("regression: search --json emits the raw response", async () => {
  _setTransport(transportFor([["/backend-anon/ps/plugins/search", response({ plugins: [searchRow()] })]]));
  const cap = capture();
  await run(["alphaxiv", "--json"], cap.out);
  const parsed = JSON.parse(cap.text());
  assert.equal(parsed.plugins[0].id, PLUGIN_ID);
});

test("regression: search --links emits bare urls", async () => {
  _setTransport(transportFor([["/backend-anon/ps/plugins/search", response({ plugins: [searchRow()] })]]));
  const cap = capture();
  await run(["alphaxiv", "--links"], cap.out);
  assert.equal(cap.text().trim(), `https://chatgpt.com/plugins/${PLUGIN_ID}`);
});

test("regression: help prints usage", async () => {
  const cap = capture();
  await run(["-h"], cap.out);
  assert.match(cap.text(), /chatgpt-plugins/);
  assert.match(cap.text(), /inspect/);
});

test("regression: invalid --limit still errors", async () => {
  await assert.rejects(() => run(["x", "--limit", "0"], () => {}), /positive integer/);
});

test("inspect table renders a report", async () => {
  _setTransport(
    transportFor([
      ["/backend-api/aip/connectors/", response({ connector_type: "mcp", mcp: { endpoint: "https://api.alphaxiv.org/mcp/v1" }, oauth: { authorization_url: "https://a", token_url: "https://t", registration_url: "https://r" } })],
      ["/backend-anon/ps/plugins/search", response({ plugins: [searchRow()] })],
      ["/backend-api/ps/plugins/", response(detail)],
    ]),
  );
  const cap = capture();
  const code = await run(["inspect", "alphaxiv"], cap.out);
  assert.equal(code, 0);
  assert.match(cap.text(), /Compatibility/);
  assert.match(cap.text(), /Independent MCP Client: Candidate/);
});

test("inspect --json renders the report schema", async () => {
  _setTransport(
    transportFor([
      ["/backend-anon/ps/plugins/search", response({ plugins: [searchRow()] })],
      ["/backend-api/ps/plugins/", response(detail)],
    ]),
  );
  const cap = capture();
  await run(["inspect", "alphaxiv", "--json"], cap.out);
  const parsed = JSON.parse(cap.text());
  assert.equal(parsed.schemaVersion, "1.0");
  assert.equal(parsed.plugin.display_name, "alphaXiv");
});

test("inspect with no target errors", async () => {
  await assert.rejects(() => run(["inspect"], () => {}), /provide a plugin name\/ID/);
});

test("inspect offline uses local json files", async () => {
  const cap = capture();
  const code = await run(
    ["inspect", "--plugin-json", "test/fixtures/plugin-alphaxiv.json", "--connector-json", "test/fixtures/connector-mcp-oauth.json"],
    cap.out,
  );
  assert.equal(code, 0);
  assert.match(cap.text(), /Type: MCP/);
});

test("inspect --summary prints one tab line", async () => {
  const cap = capture();
  await run(
    ["inspect", "--plugin-json", "test/fixtures/plugin-alphaxiv.json", "--connector-json", "test/fixtures/connector-mcp-oauth.json", "--summary"],
    cap.out,
  );
  assert.equal(cap.text().split("\n").length, 1);
  assert.match(cap.text(), /candidate/);
});

test("inspect not-found exits with code 2", async () => {
  _setTransport(transportFor([["/backend-anon/ps/plugins/search", response({ plugins: [] })]]));
  const cap = capture();
  const code = await run(["inspect", "nope"], cap.out);
  assert.equal(code, 2);
  assert.match(cap.text(), /No plugin matched/);
});
