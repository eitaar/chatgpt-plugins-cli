import { test } from "node:test";
import assert from "node:assert/strict";

import { inspect } from "../src/inspect.js";
import { formatInspection, summarize } from "../src/inspect-format.js";

async function mcpReport() {
  return inspect(undefined, {
    pluginJson: "test/fixtures/plugin-alphaxiv.json",
    connectorJson: "test/fixtures/connector-mcp-oauth.json",
    offline: true,
  });
}

test("table rendering shows the expected sections", async () => {
  const out = formatInspection(await mcpReport(), { mode: "table" });
  assert.match(out, /Plugin: alphaXiv/);
  assert.match(out, /Plugin ID: plugin_asdk_app_/);
  assert.match(out, /App ID: asdk_app_/);
  assert.match(out, /Connection/);
  assert.match(out, /Type: MCP/);
  assert.match(out, /Endpoint: https:\/\/api\.alphaxiv\.org\/mcp\/v1/);
  assert.match(out, /Authentication/);
  assert.match(out, /PKCE: S256/);
  assert.match(out, /Dynamic Registration: Endpoint advertised/);
  assert.match(out, /Scopes: email, profile/);
  assert.match(out, /Compatibility/);
  assert.match(out, /Independent MCP Client: Candidate/);
  assert.match(out, /Live Connection: Not tested/);
  assert.match(out, /Assessment:/);
});

test("table rendering never claims a verified connection", async () => {
  const out = formatInspection(await mcpReport(), { mode: "table" });
  assert.doesNotMatch(out, /connected successfully/i);
  assert.match(out, /has not been verified/);
});

test("json rendering is a stable, documented schema", async () => {
  const report = await mcpReport();
  const parsed = JSON.parse(formatInspection(report, { mode: "json" }));
  assert.equal(parsed.schemaVersion, "1.0");
  for (const key of ["target", "plugin", "sources", "connection", "authentication", "compatibility", "registration", "liveConnection", "assessmentText", "warnings"]) {
    assert.ok(key in parsed, `missing key ${key}`);
  }
  assert.equal(parsed.liveConnection.tested, false);
  assert.equal(parsed.compatibility.independentClient.state, "candidate");
  assert.equal(parsed.authentication.pkceMethod, "S256");
});

test("summary is a single tab-separated line", async () => {
  const out = summarize(await mcpReport());
  assert.equal(out.split("\n").length, 1);
  const fields = out.split("\t");
  assert.equal(fields[1], "mcp");
  assert.equal(fields[2], "candidate");
  assert.match(out, /live=no/);
});

test("not_found renders a helpful message", () => {
  const out = formatInspection({ target: "x", resolution: { status: "not_found", candidates: [] } });
  assert.match(out, /No plugin matched "x"/);
});

test("ambiguous renders the candidate IDs", () => {
  const out = formatInspection({
    target: "slack",
    resolution: { status: "ambiguous", candidates: [{ id: "plugins_a", display_name: "Slack" }, { id: "plugins_b", display_name: "Slack" }] },
  });
  assert.match(out, /matched multiple plugins/);
  assert.match(out, /plugins_a/);
  assert.match(out, /plugins_b/);
});
