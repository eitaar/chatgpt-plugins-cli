import { test } from "node:test";
import assert from "node:assert/strict";
import { pluginUrl, searchUrl } from "../src/api.js";
import { format, toRows } from "../src/format.js";

test("searchUrl includes required params and omits optional ones", () => {
  const url = new URL(searchUrl({ query: "google" }));
  assert.equal(url.pathname, "/backend-anon/ps/plugins/search");
  assert.equal(url.searchParams.get("q"), "google");
  assert.equal(url.searchParams.get("scope"), "GLOBAL");
  assert.equal(url.searchParams.get("limit"), "16");
  assert.equal(url.searchParams.has("pageToken"), false);
  assert.equal(url.searchParams.has("categoryId"), false);
});

test("searchUrl carries page token and category through", () => {
  const url = new URL(searchUrl({ query: "x", categoryId: "productivity", pageToken: "abc==" }));
  assert.equal(url.searchParams.get("categoryId"), "productivity");
  assert.equal(url.searchParams.get("pageToken"), "abc==");
});

test("pluginUrl points at the store detail route", () => {
  assert.equal(pluginUrl({ id: "plugins_123" }), "https://chatgpt.com/plugins/plugins_123");
});

const sample = {
  plugins: [
    {
      id: "plugins_1",
      name: "google-drive",
      status: "ENABLED",
      release: {
        display_name: "Google Drive",
        interface: {
          developer_name: "OpenAI",
          category: "Productivity",
          short_description: "Drive, Docs, Sheets or Slides",
        },
      },
    },
  ],
};

test("toRows maps display fields and link", () => {
  const [row] = toRows(sample);
  assert.equal(row.display_name, "Google Drive");
  assert.equal(row.developer_name, "OpenAI");
  assert.equal(row.category, "Productivity");
  assert.equal(row.url, "https://chatgpt.com/plugins/plugins_1");
});

test("table mode renders a row and a link", () => {
  const out = format({ res: sample, rows: toRows(sample), mode: "table" });
  assert.match(out, /Google Drive/);
  assert.match(out, /https:\/\/chatgpt\.com\/plugins\/plugins_1/);
  assert.match(out, /1 plugin\(s\)\./);
});

test("links mode emits bare urls", () => {
  const out = format({ res: sample, rows: toRows(sample), mode: "links" });
  assert.equal(out, "https://chatgpt.com/plugins/plugins_1");
});

test("json mode is round-trippable", () => {
  const out = format({ res: sample, rows: toRows(sample), mode: "json" });
  assert.deepEqual(JSON.parse(out), sample);
});

test("empty results say so", () => {
  const out = format({ res: { plugins: [] }, rows: [], mode: "table" });
  assert.match(out, /No plugins found\./);
});
