import { handler } from "../netlify/functions/jade-cloud.js";

function buildEvent(request, bodyText = "") {
  const headers = {};
  Object.entries(request.headers || {}).forEach(([key, value]) => {
    if (Array.isArray(value)) {
      headers[key] = value.join(", ");
      return;
    }
    headers[key] = String(value ?? "");
  });

  return {
    httpMethod: request.method,
    headers,
    body: bodyText,
    rawUrl: request.url,
    path: new URL(request.url).pathname,
  };
}

function toBodyText(request) {
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

  return "";
}

export default async function vercelCloudHandler(request, response) {
  const result = await handler(buildEvent(request, toBodyText(request)));
  const statusCode = Number(result?.statusCode || 200);
  const headers = result?.headers || {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  };

  Object.entries(headers).forEach(([key, value]) => {
    response.setHeader(key, value);
  });

  response.status(statusCode).send(result?.body || "");
}
