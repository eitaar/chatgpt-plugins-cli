// Renders an inspect() report for humans or as stable JSON.

const CONNECTION_TYPE_LABEL = {
  mcp: "MCP",
  "rest-openapi": "REST/OpenAPI",
  "agent-plugin": "Agent Plugin package",
  "chatgpt-specific": "ChatGPT-specific integration",
  unknown: "Unknown",
};

const STATE_LABEL = {
  candidate: "Candidate",
  requires_verification: "Requires verification",
  unsupported: "Unsupported",
  unknown: "Unknown",
};

function yesNo(value) {
  return value ? "yes" : "no";
}

function indented(title, pairs) {
  const lines = [`${title}`];
  for (const [key, value] of pairs) {
    lines.push(`  ${key}: ${value}`);
  }
  return lines.join("\n");
}

export function formatInspection(report, { mode = "table" } = {}) {
  if (mode === "json") {
    return JSON.stringify(report, null, 2);
  }
  if (mode === "summary") {
    return summarize(report);
  }

  const out = [];

  if (report.resolution?.status === "not_found") {
    out.push(`No plugin matched "${report.target}".`);
    return out.join("\n\n");
  }
  if (report.resolution?.status === "ambiguous") {
    out.push(`"${report.target}" matched multiple plugins. Re-run with an exact ID:`);
    for (const c of report.resolution.candidates) {
      out.push(`  - ${c.display_name} (${c.id})`);
    }
    return out.join("\n\n");
  }

  if (report.plugin) {
    out.push(
      [
        `Plugin: ${report.plugin.display_name ?? "(unknown)"}`,
        `Plugin ID: ${report.plugin.id ?? "(unknown)"}`,
        `App ID: ${report.plugin.app_ids.join(", ") || "(none)"}`,
      ].join("\n"),
    );
  } else {
    out.push("Plugin: (none — connector inspected from local JSON)");
  }

  const endpoint = report.connection.endpoint ?? "(not advertised)";
  out.push(
    indented("Connection", [
      ["Type", CONNECTION_TYPE_LABEL[report.connection.type] ?? report.connection.type],
      ["Endpoint", endpoint],
    ]),
  );

  const auth = report.authentication;
  const authPairs = [["Type", auth.type]];
  if (auth.type === "oauth") {
    authPairs.push(["PKCE", auth.pkce ? `${auth.pkceMethod ?? "required"}` : "not advertised"]);
    authPairs.push(["Dynamic Registration", auth.registrationUrl ? "Endpoint advertised" : "not advertised"]);
    authPairs.push(["Scopes", auth.scopes.length ? auth.scopes.join(", ") : "none advertised"]);
    if (auth.clientAuthMethods.length) authPairs.push(["Client Auth Methods", auth.clientAuthMethods.join(", ")]);
    if (auth.issuerUrl) authPairs.push(["Issuer", auth.issuerUrl]);
  }
  out.push(indented("Authentication", authPairs));

  const compat = report.compatibility;
  out.push(
    indented("Compatibility", [
      ["Independent MCP Client", STATE_LABEL[compat.independentClient.state] ?? compat.independentClient.state],
      ["OAuth Registration", report.registration.advertised ? "Requires verification" : "Not advertised"],
      ["Agent Plugin Package", compat.protocol.classification === "agent-plugin" ? "Identify possible" : "Not identified"],
      ["Live Connection", "Not tested"],
    ]),
  );

  out.push(`Assessment:\n  ${wrap(report.assessmentText, 60, "  ")}`);

  if (report.warnings.length) {
    out.push(`Warnings:\n${report.warnings.map((w) => `  - ${w}`).join("\n")}`);
  }

  return out.join("\n\n");
}

function wrap(text, width, indent) {
  const words = String(text).split(/\s+/);
  const lines = [];
  let line = "";
  for (const word of words) {
    if ((line + " " + word).trim().length > width) {
      lines.push(line.trim());
      line = word;
    } else {
      line += " " + word;
    }
  }
  if (line.trim()) lines.push(line.trim());
  return lines.join(`\n${indent}`);
}

// Compact one-line summary, handy for scripting.
export function summarize(report) {
  const name = report.plugin?.display_name ?? report.target ?? "connector";
  const state = report.compatibility?.independentClient?.state ?? "unknown";
  const type = report.connection?.type ?? "unknown";
  return `${name}\t${type}\t${state}\tlive=${yesNo(report.liveConnection?.tested)}`;
}
