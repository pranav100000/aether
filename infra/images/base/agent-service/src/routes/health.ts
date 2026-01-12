import { getAvailableProviders } from "../providers";

export function handleHealth(): Response {
  const providers = getAvailableProviders();

  return Response.json({
    status: "healthy",
    version: "1.0.0",
    providers,
  });
}
