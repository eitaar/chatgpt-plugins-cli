# chatgpt-plugins-cli

Unofficial CLI over ChatGPT's public plugin-search API, plus an experimental
**plugin inspector** that resolves a plugin to its App/Connector configuration
and assesses whether an independent AI agent harness could connect to the same
external service.

```
$ cgp google
$ cgp inspect alphaxiv
$ cgp inspect alphaxiv --json
$ cgp inspect --plugin-json ./plugin.json --connector-json ./connector.json
```

> **Disclaimer** — This project is **unofficial** and is **not affiliated with,
> endorsed by, or supported by OpenAI**. It relies on undocumented, internal
> endpoints that OpenAI may change, restrict, or remove at any time without
> notice; the tool may stop working at any moment. Use it at your own risk and
> only for personal, read-only lookups. You are responsible for complying with
> OpenAI's terms of service and any applicable rate limits. No warranty of any
> kind is provided.

---

## The three API layers

The extension surface is three endpoints with **very different access models** —
this is the most important thing to understand:

| Layer | Endpoint | Access | Returns |
| ----- | -------- | ------ | ------- |
| 1. Search | `GET /backend-anon/ps/plugins/search?q=&scope=&limit=` | **Public** (needs `oai-device-id`) | plugin list + IDs |
| 2. Plugin detail | `GET /backend-api/ps/plugins/{plugin_id}` | **Public** (verified) | plugin metadata, `canonical_app_id`, `release.app_manifest` |
| 3. Connector detail | `GET /backend-api/aip/connectors/{app_id}?include_actions=false` | **Auth-gated** (401/403) | `connector_type`, `base_url`, `service`, `supported_auth`, OAuth URLs, scopes, PKCE, capabilities |

### Layer 1 — Search

```
$ cgp google
"google"
#    Name                              Developer               Category            Status
---  --------------------------------  ----------------------  ------------------  --------
1    Google Drive                      OpenAI                  Productivity        ENABLED
...
 1. Google Drive — https://chatgpt.com/plugins/plugin_connector_1p_ab21a553bfbc81919ea8fd1858e3ffa7
```

| Param        | Notes                                                        |
| ------------ | ------------------------------------------------------------ |
| `q`          | search text                                                  |
| `scope`      | `GLOBAL` (default) or `WORKSPACE`                            |
| `limit`      | page size                                                    |
| `categoryId` | optional `plugin_category_id` filter (e.g. `productivity`)   |
| `pageToken`  | opaque cursor from `pagination.next_page_token`              |

Like the web app, this needs the device header or Cloudflare answers **451**:

```
oai-device-id: <any UUID v4>
```

The CLI generates one on first run and stores it at
`~/.config/chatgpt-plugins/device-id` (override with `--device-id` / `OAI_DEVICE_ID`).
A companion browse endpoint, `GET /backend-anon/ps/plugins/home`, powers `cgp home`.

### Layer 2 — Plugin detail (public, experimental)

Returns the search-row fields plus `release.app_manifest` (the linked App
dependencies). **Verified working with no authentication.** The CLI uses it to
turn a plugin into its App ID(s).

```
GET https://chatgpt.com/backend-api/ps/plugins/plugin_asdk_app_6a69834b831c8191a0281d6aca1722f0
```

### Layer 3 — Connector detail (auth-gated, experimental)

This holds the interesting part — `connector_type`, `base_url`, `service`, OAuth
URLs, scopes, PKCE. **It is not anonymously accessible.** A request without a
session token returns:

```json
{"detail":{"message":"Unauthorized - Access token is missing"}}
```

The CLI **does not** scrape cookies, replay a logged-in session, or bypass the
challenge. When the endpoint is gated it reports that plainly and falls back to
**offline JSON inspection** (below).

### Raw fetch (no CLI)

```bash
curl -s 'https://chatgpt.com/backend-anon/ps/plugins/search?q=google&scope=GLOBAL&limit=16' \
  -H 'oai-device-id: 00000000-0000-4000-8000-000000000000' \
  -H 'user-agent: Mozilla/5.0' \
| jq -r '.plugins[] | "\(.release.display_name)\thttps://chatgpt.com/plugins/\(.id)"'
```

---

## The inspector

```
cgp inspect <name|id> [options]
```

It resolves a plugin by exact ID or name, fetches plugin metadata, extracts the
linked App IDs, retrieves connector metadata **when accessible**, classifies the
connection protocol and authentication, and produces a compatibility assessment.

```
$ cgp inspect --plugin-json ./plugin.json --connector-json ./connector.json
Plugin: alphaXiv
Plugin ID: plugin_asdk_app_6a69834b831c8191a0281d6aca1722f0
App ID: asdk_app_6a69834b831c8191a0281d6aca1722f0

Connection
  Type: MCP
  Endpoint: https://api.alphaxiv.org/mcp/v1

Authentication
  Type: oauth
  PKCE: S256
  Dynamic Registration: Endpoint advertised
  Scopes: email, profile
  Client Auth Methods: none, client_secret_post
  Issuer: https://api.alphaxiv.org

Compatibility
  Independent MCP Client: Candidate
  OAuth Registration: Requires verification
  Agent Plugin Package: Not identified
  Live Connection: Not tested

Assessment:
  The connector metadata describes an MCP endpoint. An OAuth
  registration mechanism is advertised. Independent connection
  appears plausible but has not been verified.
```

Ran live (`cgp inspect alphaxiv`), layer 2 succeeds and layer 3 is gated, so the
report says so and recommends `--connector-json`:

```
Connection
  Type: Unknown
  Endpoint: (not advertised)
...
Assessment:
  No connector metadata was available, so the external protocol and
  authentication cannot be determined. The connector endpoint is
  access-gated (experimental internal API) and requires an
  authenticated access token. Re-run with --connector-json <file> using
  metadata you obtained yourself, or pass your own --token.
```

### Resolving names

- Input starting with `plugin_`/`plugins_` is treated as an ID and fetched directly.
- Otherwise the CLI searches. It picks an **exact** display-name/`name` match; if
  several plugins tie, it refuses to guess and exits with code `2`, listing the
  candidate IDs. Re-run with `cgp inspect <plugin_id>`.
- An exact ID is always unambiguous.

### Options

```
      --plugin-json <file>     offline plugin metadata (detail or search response)
      --connector-json <file>  offline connector metadata
      --include-actions        include connector actions when reachable
      --summary                one-line tab-separated summary
      --json                   stable JSON report (schemaVersion 1.0)
      --token <t>              your own bearer token (or CGP_ACCESS_TOKEN)
      --cookie <c>             your own cookie header (or CGP_COOKIE)
```

### Offline JSON inspection

Because layer 3 is gated, the inspector works from files. Export the JSON
yourself (DevTools → Network, or your own authenticated client) and pass it in.
This needs no network access at all:

```bash
cgp inspect --plugin-json ./plugin.json --connector-json ./connector.json
cgp inspect --plugin-json ./plugin.json --connector-json ./connector.json --json > report.json
```

`--plugin-json` accepts a **search response**, a **detail response**, or a bare
plugin object. `--connector-json` accepts a connector object. All forms are
detected automatically.

### Compatibility states

Every assessment uses explicit, honest states:

| State | Meaning |
| ----- | ------- |
| `candidate` | metadata describes a reachable protocol **and** a plausible client-registration path (e.g. MCP + OAuth registration URL). Still unverified. |
| `requires_verification` | signals exist but something is missing (no registration URL, unclear auth, no protocol identified). |
| `unsupported` | metadata shows it cannot work independently (e.g. requires a local executor). |
| `unknown` | not enough metadata to say. |

**Metadata never proves a connection.** A connector is never reported as
compatible/working from metadata alone. Four axes are kept separate:

1. **Metadata availability** — do we even have connector metadata?
2. **Authentication capability** — what auth does it advertise?
3. **External protocol compatibility** — is there a reachable MCP/REST endpoint?
4. **Actual connection verification** — always `not tested`. This tool never
   performs an OAuth login or opens an MCP connection.

### JSON schema (for rspshermes)

`--json` emits a stable report. Top-level keys:

```jsonc
{
  "schemaVersion": "1.0",
  "generatedAt": "2026-...",
  "experimental": true,
  "target": "alphaxiv",
  "resolution": { "status": "resolved", "via": "search", "candidates": [] },
  "plugin": { "id": "...", "display_name": "alphaXiv", "app_ids": ["..."], "category": "...", "developer_name": "..." },
  "sources": { "plugin": "live|file|none", "connector": "live|file|none" },
  "connector": { "id": "...", "service": "...", "base_url": "...", "connectorType": "..." },
  "connection": { "type": "mcp|rest-openapi|agent-plugin|chatgpt-specific|unknown", "endpoint": "...", "reasons": [] },
  "authentication": {
    "type": "oauth|api_key|unknown",
    "authorizationUrl": "...", "tokenUrl": "...", "registrationUrl": "...", "issuerUrl": "...",
    "scopes": [], "pkce": true, "pkceMethod": "S256", "clientAuthMethods": [], "reasons": []
  },
  "compatibility": { "metadata": {}, "authentication": {}, "protocol": {}, "independentClient": { "state": "candidate", "reasons": [] } },
  "registration": { "advertised": true, "registrationUrl": "..." },
  "liveConnection": { "tested": false, "state": "not_tested", "note": "..." },
  "assessmentText": "...",
  "warnings": [],
  "errors": []
}
```

---

## Programmatic use

The inspector is plain ESM with no runtime dependencies, so another Node project
can call it directly:

```js
import { inspect } from "chatgpt-plugins-cli/src/inspect.js";
import { assessCompatibility, normalizeConnector } from "chatgpt-plugins-cli/src/compatibility.js";

const report = await inspect("alphaxiv");                                  // live (connector may be gated)
const offline = await inspect(undefined, {
  pluginJson: "./plugin.json",
  connectorJson: "./connector.json",
  offline: true,
});

// Or assess metadata you already normalized:
const assessment = assessCompatibility(normalizeConnector(connRaw), pluginRaw, { connectorSource: "file" });
```

---

## Limitations of metadata-based compatibility checks

- **Layer 3 is auth-gated.** Live connector inspection generally returns 401/403.
  Use `--connector-json`. Do not expect live connector data without a token you
  own; even then the endpoint shape may change.
- **Only the first App ID is queried live.** Multi-app plugins report all App
  IDs, but the live connector fetch uses the first one (offline you control the file).
- **Field names are inferred.** The internal connector schema is undocumented, so
  normalization checks several common spellings (`oauth`/`oauth2`/`authorization`,
  `authorization_url`/`authorize_url`/`auth_url`, …). Unknown shapes degrade to
  `unknown` rather than guessing.
- **No verification.** Classification is metadata-only; nothing here proves a
  live connection. A `candidate` is a hypothesis, not a result.

## Security considerations

- **No credential scraping.** The tool never reads browser cookies, replays a
  logged-in session, or circumvents a challenge.
- **Credentials are opt-in and optional.** `--token`/`CGP_ACCESS_TOKEN` and
  `--cookie`/`CGP_COOKIE` are used only for your own requests, read only from
  flags or the environment, and never written to disk or logs.
- **Offline mode is fully local.** `--plugin-json`/`--connector-json` make no
  network calls, so gated endpoints can be inspected without authentication.
- The only thing persisted is a random device UUID at
  `~/.config/chatgpt-plugins/device-id` (mode `0600`).
- `--connector-json` can contain OAuth secrets; treat exported files as sensitive.

## Install

```bash
npm link          # exposes `chatgpt-plugins` and `cgp`
# or run directly:
node bin/chatgpt-plugins.js inspect alphaxiv
```

Requires Node >= 20 (`fetch`, `node:util` `parseArgs`, `node:test`).
Zero runtime dependencies.

## Usage (all commands)

```
chatgpt-plugins <query> [options]        search plugins (e.g. "google")
chatgpt-plugins home [options]           featured / browse sections
chatgpt-plugins inspect <name|id>        inspect a plugin's connector + compatibility
chatgpt-plugins inspect --plugin-json <f> --connector-json <g>

Search:  -n/--limit  --all  --max-pages  --scope  --category  --page-token  --links
Inspect: --plugin-json  --connector-json  --include-actions  --summary  --token  --cookie
Global:  --json  --device-id  --lang  -h/--help
```

Examples:

```bash
cgp google
cgp google --json | jq -r '.plugins[].release.display_name'
cgp "github" --all --links                          # every GitHub plugin, one URL per line
cgp inspect alphaxiv
cgp inspect alphaxiv --json
cgp inspect plugin_asdk_app_6a69834b831c8191a0281d6aca1722f0
cgp inspect --plugin-json ./plugin.json --connector-json ./connector.json --summary
```

## Development

```bash
npm test    # node --test  (61 tests, fully mocked HTTP)
```

Layout:

```
src/api.js             endpoints, headers, device id, ApiError, injectable transport
src/inspect-plugin.js  plugin resolution + app-id extraction + normalization
src/inspect.js         orchestration (resolve -> fetch -> fallback -> assess)
src/compatibility.js   classification + 4-axis compatibility assessment
src/inspect-format.js  terminal / summary / JSON rendering
src/cli.js             argument parsing + command dispatch
bin/chatgpt-plugins.js entry point
test/                  unit + integration tests and JSON fixtures
```

Tests use a fake transport (`_setTransport`) so no real sockets are opened.
