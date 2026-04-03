export default {
  fetch() {
    return Response.json({
      ok: true,
      service: "jade-ping",
      provider: "vercel",
    });
  },
};
