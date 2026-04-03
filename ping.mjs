export function GET() {
  return Response.json({
    ok: true,
    service: "jade-ping",
    provider: "vercel",
  });
}
