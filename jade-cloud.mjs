import cloudModule from "../netlify/functions/jade-cloud.js";

const { handler } = cloudModule;

function buildEvent(request, bodyText = "") {
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

async function callCloudHandler(request, bodyText = "") {
  const result = await handler(buildEvent(request, bodyText));

  return new Response(result?.body || "", {
    status: Number(result?.statusCode || 200),
    headers: result?.headers || {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

export async function GET(request) {
  return callCloudHandler(request, "");
}

export async function POST(request) {
  const bodyText = await request.text();
  return callCloudHandler(request, bodyText);
}
