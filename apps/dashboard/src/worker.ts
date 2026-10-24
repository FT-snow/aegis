interface DashboardEnvironment {
  AEGIS_API_ORIGIN?: string;
  ASSETS: {
    fetch(request: Request): Promise<Response>;
  };
}

function proxyError(message: string, status: number): Response {
  return Response.json({ error: message }, { status });
}

export default {
  async fetch(request: Request, env: DashboardEnvironment): Promise<Response> {
    const incoming = new URL(request.url);
    if (incoming.pathname !== "/api" && !incoming.pathname.startsWith("/api/")) {
      return env.ASSETS.fetch(request);
    }

    const configuredOrigin = env.AEGIS_API_ORIGIN?.trim();
    if (!configuredOrigin) return proxyError("API_PROXY_NOT_CONFIGURED", 503);

    let apiOrigin: URL;
    try {
      apiOrigin = new URL(configuredOrigin);
    } catch {
      return proxyError("API_PROXY_ORIGIN_INVALID", 500);
    }
    if (!["https:", "http:"].includes(apiOrigin.protocol) || apiOrigin.pathname !== "/" || apiOrigin.search || apiOrigin.hash) {
      return proxyError("API_PROXY_ORIGIN_INVALID", 500);
    }

    const upstreamUrl = new URL(`${incoming.pathname}${incoming.search}`, apiOrigin);
    const headers = new Headers(request.headers);
    headers.delete("host");
    const init: RequestInit = { method: request.method, headers, redirect: "manual" };
    if (request.method !== "GET" && request.method !== "HEAD") init.body = request.body;
    return fetch(new Request(upstreamUrl, init));
  },
};
