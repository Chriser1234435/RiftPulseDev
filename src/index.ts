export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/v1/health") {
      return Response.json({
        service: "riftpulse-api",
        status: "ok",
        version: "0.1.0-dev",
      });
    }

    return new Response("RiftPulseDev API foundation", {
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  },
} satisfies ExportedHandler;
