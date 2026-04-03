module.exports = function handler(request, response) {
  response.status(200).json({
    ok: true,
    service: "jade-ping",
    provider: "vercel",
    method: request.method,
  });
};
