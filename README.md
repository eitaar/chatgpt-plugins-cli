# chatgpt-plugins-cli

Unofficial CLI over ChatGPT's public plugin-search API. Type a query, get the
matching plugins and their `https://chatgpt.com/plugins/<id>` links — in the
terminal or piped into `jq`/`curl`.

> **Disclaimer** — This project is **unofficial** and is **not affiliated with,
> endorsed by, or supported by OpenAI**. It relies on an undocumented, internal
> endpoint (`backend-anon/ps/plugins`) that OpenAI may change, restrict, or
> remove at any time without notice; the tool may stop working at any moment.
> Use it at your own risk and only for personal, read-only lookups. You are
> responsible for complying with OpenAI's terms of service and any applicable
> rate limits. No warranty of any kind is provided.

```
$ chatgpt-plugins google
"google"
#    Name                              Developer               Category            Status
---  --------------------------------  ----------------------  ------------------  --------
1    Google Drive                      OpenAI                  Productivity        ENABLED
2    Windsor.ai Google Ads             Windsor.ai              Business & Operat…  ENABLED
...
 1. Google Drive — https://chatgpt.com/plugins/plugin_connector_1p_ab21a553bfbc81919ea8fd1858e3ffa7
```

## The API

The page at `https://chatgpt.com/plugins?search=...` loads its data from a public,
**unauthenticated** endpoint:

```
GET https://chatgpt.com/backend-anon/ps/plugins/search?q=google&scope=GLOBAL&limit=16
```

| Param        | Notes                                                        |
| ------------ | ------------------------------------------------------------ |
| `q`          | search text                                                  |
| `scope`      | `GLOBAL` (default) or `WORKSPACE`                            |
| `limit`      | page size                                                    |
| `categoryId` | optional `plugin_category_id` filter (e.g. `productivity`)   |
| `pageToken`  | opaque cursor from `pagination.next_page_token`              |

Companion endpoint for the browse page: `GET /backend-anon/ps/plugins/home`
(returns `sections[].plugins[]`, a lighter shape than search).

### Required header

Cloudflare answers **451** without the device header the web app always sends.
One header is enough:

```
oai-device-id: <any UUID v4>
```

The CLI generates one on first run and stores it at
`~/.config/chatgpt-plugins/device-id` (override with `--device-id` or
`OAI_DEVICE_ID`). HTML page routes (`/plugins/<id>`) are behind an interactive
Cloudflare challenge, but this JSON API is not.

### Response shape

```jsonc
{
  "plugins": [
    {
      "id": "plugin_connector_1p_ab21a553bfbc81919ea8fd1858e3ffa7",
      "name": "google-drive",
      "status": "ENABLED",
      "installation_policy": "AVAILABLE",
      "release": {
        "display_name": "Google Drive",
        "description": "...",
        "keywords": ["google", "drive", "..."],
        "interface": {
          "short_description": "Drive, Docs, Sheets or Slides",
          "developer_name": "OpenAI",
          "category": "Productivity",
          "plugin_category_id": "productivity",
          "capabilities": ["Interactive", "Write"],
          "website_url": "https://workspace.google.com/products/drive/",
          "logo_url": "https://files.openai.com/content?id=..."
        }
      }
    }
  ],
  "pagination": { "limit": 16, "next_page_token": "eyJxIjoi..." }
}
```

The link is simply `https://chatgpt.com/plugins/{plugins[].id}`.

### Raw fetch (no CLI)

```bash
curl -s 'https://chatgpt.com/backend-anon/ps/plugins/search?q=google&scope=GLOBAL&limit=16' \
  -H 'oai-device-id: 00000000-0000-4000-8000-000000000000' \
  -H 'user-agent: Mozilla/5.0' \
| jq -r '.plugins[] | "\(.release.display_name)\thttps://chatgpt.com/plugins/\(.id)"'
```

## Install

```bash
npm link          # exposes `chatgpt-plugins` and `cgp`
# or run directly:
node bin/chatgpt-plugins.js google
```

Requires Node >= 20 (uses the built-in `fetch` and `node:util` `parseArgs`).
Zero runtime dependencies.

## Usage

```
chatgpt-plugins <query> [options]      search plugins
chatgpt-plugins home [options]         featured / browse sections

Options:
  -n, --limit <n>      results per page (default 16)
      --all            follow pagination and combine pages
      --max-pages <n>  cap for --all (default 10)
      --scope <s>      GLOBAL | WORKSPACE (default GLOBAL)
      --category <id>  filter by plugin_category_id
      --page-token <t> continue from a previous page
      --json           print the raw API response
      --links          print only the plugin URLs
      --device-id <id> override the oai-device-id header
      --lang <tag>     oai-language header (default en-US)
  -h, --help
```

Examples:

```bash
chatgpt-plugins google
chatgpt-plugins google --json | jq -r '.plugins[].release.display_name'
chatgpt-plugins "github" --all --links      # every GitHub-related plugin, one URL per line
chatgpt-plugins home --json
chatgpt-plugins slack --category productivity
```

> Note: the API is undocumented and may change without notice. `searchAll` stops
> after `--max-pages` and marks the result truncated rather than looping forever.

## Development

```bash
npm test        # node --test
```

Layout: `src/api.js` (endpoint + headers), `src/format.js` (table/json/links),
`src/cli.js` (arg parsing), `bin/chatgpt-plugins.js` (entry).
