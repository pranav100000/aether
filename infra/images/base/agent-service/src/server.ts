import { handleHealth } from "./routes/health";
import { handleCompletion } from "./routes/completion";

const PORT = parseInt(process.env.PORT || "8080", 10);

const server = Bun.serve({
  port: PORT,
  async fetch(request) {
    const url = new URL(request.url);
    const method = request.method;

    // CORS headers for preflight
    if (method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, Authorization",
        },
      });
    }

    // Route handling
    if (url.pathname === "/health" && method === "GET") {
      return handleHealth();
    }

    if (url.pathname === "/v1/completion" && method === "POST") {
      const response = await handleCompletion(request);
      // Add CORS headers to response
      response.headers.set("Access-Control-Allow-Origin", "*");
      return response;
    }

    // 404 for unknown routes
    return new Response(
      JSON.stringify({ error: { code: "not_found", message: "Not found" } }),
      { status: 404, headers: { "Content-Type": "application/json" } }
    );
  },
});

console.log(`Agent service listening on port ${PORT}`);
