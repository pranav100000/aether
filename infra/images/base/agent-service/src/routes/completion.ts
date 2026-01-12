import { extractBearerToken, validateSessionToken } from "../auth/session";
import { getProvider, type ProviderType } from "../providers";
import { UsageTracker } from "../usage/tracker";
import type { CompletionRequest, StreamEvent } from "../types";

export async function handleCompletion(request: Request): Promise<Response> {
  // Validate authentication
  let session;
  try {
    const token = extractBearerToken(request.headers.get("Authorization"));
    session = await validateSessionToken(token);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Authentication failed";
    return new Response(JSON.stringify({ error: { code: "auth_error", message } }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Parse request body
  let body: CompletionRequest;
  try {
    body = await request.json();
  } catch {
    return new Response(
      JSON.stringify({ error: { code: "invalid_request", message: "Invalid JSON body" } }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  // Validate required fields
  if (!body.provider || !body.model || !body.prompt) {
    return new Response(
      JSON.stringify({
        error: { code: "invalid_request", message: "provider, model, and prompt are required" },
      }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  // Validate provider type
  const validProviders: ProviderType[] = ["claude", "codex", "codebuff", "opencode"];
  if (!validProviders.includes(body.provider)) {
    return new Response(
      JSON.stringify({
        error: { code: "invalid_request", message: `Invalid provider: ${body.provider}` },
      }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  // Get provider
  const provider = getProvider(body.provider);
  if (!provider.isConfigured()) {
    return new Response(
      JSON.stringify({
        error: { code: "provider_not_configured", message: `Provider ${body.provider} is not configured` },
      }),
      { status: 503, headers: { "Content-Type": "application/json" } }
    );
  }

  // Create usage tracker
  const tracker = new UsageTracker(session, body.provider, body.model);

  // Create SSE stream
  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();

      const sendEvent = (event: StreamEvent) => {
        const data = `event: message\ndata: ${JSON.stringify(event)}\n\n`;
        controller.enqueue(encoder.encode(data));
      };

      try {
        for await (const event of provider.streamCompletion(body.prompt, {
          model: body.model,
          options: body.options,
        })) {
          sendEvent(event);

          // Track usage from done event
          if (event.type === "done" && event.usage) {
            tracker.setTokens(event.usage.inputTokens, event.usage.outputTokens);
          }
        }

        // Record usage after completion
        await tracker.recordUsage("completed");

        // Send final usage event
        const usage = tracker.getUsage();
        const usageEvent = `event: usage\ndata: ${JSON.stringify({
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          cost: usage.cost,
          model: body.model,
        })}\n\n`;
        controller.enqueue(encoder.encode(usageEvent));
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error";
        sendEvent({ type: "error", error: message });
        await tracker.recordUsage("failed");
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
