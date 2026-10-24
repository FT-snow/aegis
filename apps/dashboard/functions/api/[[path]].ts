interface PagesEnvironment {
  AEGIS_API_ORIGIN?: string;
}

interface PagesFunctionContext {
  request: Request;
  env: PagesEnvironment;
}

export async function onRequest({ request, env }: PagesFunctionContext): Promise<Response> {
  const configuredOrigin = env.AEGIS_API_ORIGIN?.trim();
  if (!configuredOrigin) {
    return Response.json({ error: "API_PROXY_NOT_CONFIGURED" }, { status: 503 });
  }

  let apiOrigin: URL;
  try {
    apiOrigin = new URL(configuredOrigin);
  } catch {
    return Response.json({ error: "API_PROXY_ORIGIN_INVALID" }, { status: 500 });
  }
  if (!(["https:", "http:"].includes(apiOrigin.protocol)) || apiOrigin.pathname !== "/" || apiOrigin.search || apiOrigin.hash) {
    return Response.json({ error: "API_PROXY_ORIGIN_INVALID" }, { status: 500 });
  }

  const incoming = new URL(request.url);
  const upstreamUrl = new URL(`${incoming.pathname}${incoming.search}`, apiOrigin);
  const headers = new Headers(request.headers);
  headers.delete("host");

  const init: RequestInit = {
    method: request.method,
    headers,
    redirect: "manual",
  };
  if (request.method !== "GET" && request.method !== "HEAD") init.body = request.body;

  return fetch(new Request(upstreamUrl, init));
}
