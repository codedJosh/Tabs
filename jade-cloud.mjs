import cloudModule from "../netlify/functions/jade-cloud.js";

const { handler } = cloudModule;

function buildEvent(request, bodyText) {
  const headers = {};
  request.headers.forEach((value, key) => {
    headers[key] = value;
  });

  return {
    httpMethod: request.method,
    headers,
    body: bodyText,
    rawUrl: request.url,
    path: new URL(request.url).pathname,
  };
}

export default {
  async fetch(request) {
    const method = String(request.method || "GET").toUpperCase();
    const bodyText = method === "GET" || method === "HEAD" ? "" : await request.text();
    const result = await handler(buildEvent(request, bodyText));

    return new Response(result?.body || "", {
      status: Number(result?.statusCode || 200),
      headers: result?.headers || {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  },
};
