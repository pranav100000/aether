import * as jose from "jose";
import type { SessionPayload } from "../types";

const SECRET_KEY = new TextEncoder().encode(
  process.env.AGENT_SERVICE_SECRET || ""
);

export async function validateSessionToken(
  token: string
): Promise<SessionPayload> {
  if (!process.env.AGENT_SERVICE_SECRET) {
    throw new Error("AGENT_SERVICE_SECRET not configured");
  }

  const { payload } = await jose.jwtVerify(token, SECRET_KEY, {
    algorithms: ["HS256"],
  });

  const session = payload as unknown as SessionPayload;

  if (!session.user_id || !session.project_id) {
    throw new Error("Invalid session token: missing required fields");
  }

  return session;
}

export function extractBearerToken(authHeader: string | null): string {
  if (!authHeader) {
    throw new Error("Missing Authorization header");
  }

  const parts = authHeader.split(" ");
  if (parts.length !== 2 || parts[0] !== "Bearer") {
    throw new Error("Invalid Authorization header format");
  }

  return parts[1];
}
