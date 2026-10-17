// Shared test helpers: a fake HTTP transport so no real sockets are opened.

export function response(body, { status = 200 } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => (name.toLowerCase() === "content-type" ? "application/json" : null) },
    async text() {
      return typeof body === "string" ? body : JSON.stringify(body);
    },
  };
}

// Routes by substring match against the request URL. First match wins.
export function transportFor(routes) {
  const calls = [];
  const fn = async (url) => {
    calls.push(url);
    for (const [needle, handler] of routes) {
      if (url.includes(needle)) {
        const value = typeof handler === "function" ? handler(url) : handler;
        if (value instanceof Error) throw value;
        return value;
      }
    }
    return response({ detail: "Not Found" }, { status: 404 });
  };
  fn.calls = calls;
  return fn;
}
