const worker = {
  async fetch(request, env) {
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method Not Allowed", {
        status: 405,
        headers: { allow: "GET, HEAD" },
      })
    }

    const url = new URL(request.url)
    if (url.pathname === "/") {
      url.pathname = "/index.html"
    }

    return env.ASSETS.fetch(new Request(url, request))
  },
}

export default worker
