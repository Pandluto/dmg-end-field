const index = {
  async fetch(request, env) {
    const response = await env.ASSETS.fetch(request);
    const url = new URL(request.url);
    const acceptsHtml = request.headers.get("Accept")?.includes("text/html") ?? false;
    const mustRevalidate = request.mode === "navigate" || acceptsHtml || url.pathname === "/" || url.pathname === "/index.html" || url.pathname === "/sw.js" || url.pathname === "/manifest.webmanifest";
    if (!mustRevalidate) return response;
    const headers = new Headers(response.headers);
    headers.set("Cache-Control", "no-store, no-cache, must-revalidate");
    headers.set("Pragma", "no-cache");
    if (url.pathname === "/sw.js") {
      headers.set("Service-Worker-Allowed", "/");
    }
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers
    });
  }
};
const workerEntry = index ?? {};
export {
  workerEntry as default
};
