const handlerModulePromise = import("./netlify/functions/jade-cloud.js");

function toAbsoluteUrl(request) {
  const host = request.headers?.host || "localhost";
  const protocol =
    request.headers?.["x-forwarded-proto"] ||
    request.headers?.["X-Forwarded-Proto"] ||
    "https";
  return new URL(request.url || "/", protocol + "://" + host);
}

async function toBodyText(request) {
  if (request.method === "GET" || request.method === "HEAD") {
    return "";
  }

  if (typeof request.body === "string") {
    return request.body;
  }

  if (Buffer.isBuffer(request.body)) {
    return request.body.toString("utf8");
  }

  if (request.body && typeof request.body === "object") {
    return JSON.stringify(request.body);
  }

  if (!request.readable) {
    return "";
  }

  const chunks = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }

  return Buffer.concat(chunks).toString("utf8");
}

async function buildEvent(request) {
  const headers = {};
  Object.entries(request.headers || {}).forEach(([key, value]) => {
    if (Array.isArray(value)) {
      headers[key] = value.join(", ");
      return;
    }
    headers[key] = String(value ?? "");
  });

  const url = toAbsoluteUrl(request);
  return {
    httpMethod: request.method,
    headers,
    body: await toBodyText(request),
    rawUrl: url.toString(),
    path: url.pathname,
  };
}

module.exports = async function vercelCloudHandler(request, response) {
  const { handler } = await handlerModulePromise;
  const result = await handler(await buildEvent(request));
  const statusCode = Number(result?.statusCode || 200);
  const headers = result?.headers || {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  };

  Object.entries(headers).forEach(([key, value]) => {
    response.setHeader(key, value);
  });

  response.status(statusCode).send(result?.body || "");
};
