interface DashboardEnvironment {
  AEGIS_API: {
    fetch(request: Request): Promise<Response>;
  };
  ASSETS: {
    fetch(request: Request): Promise<Response>;
  };
}

export default {
  async fetch(request: Request, env: DashboardEnvironment): Promise<Response> {
    const incoming = new URL(request.url);
    if (incoming.pathname !== "/api" && !incoming.pathname.startsWith("/api/")) {
      return env.ASSETS.fetch(request);
    }

    return env.AEGIS_API.fetch(request);
  },
};
