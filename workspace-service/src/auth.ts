import * as jose from "jose";

// Cache for JWKS
let jwksCache: jose.JSONWebKeySet | null = null;
let jwksCacheTime = 0;
const JWKS_CACHE_TTL = 60 * 60 * 1000; // 1 hour

const SUPABASE_URL = process.env.SUPABASE_URL;

if (!SUPABASE_URL) {
  console.warn("Warning: SUPABASE_URL not set. Auth will fail.");
}

// Fetch and cache JWKS from Supabase
async function getJWKS(): Promise<jose.JSONWebKeySet> {
  const now = Date.now();

  if (jwksCache && now - jwksCacheTime < JWKS_CACHE_TTL) {
    return jwksCache;
  }

  if (!SUPABASE_URL) {
    throw new Error("SUPABASE_URL not configured");
  }

  const jwksUrl = `${SUPABASE_URL}/auth/v1/.well-known/jwks.json`;
  const response = await fetch(jwksUrl);

  if (!response.ok) {
    throw new Error(`Failed to fetch JWKS: ${response.status}`);
  }

  jwksCache = (await response.json()) as jose.JSONWebKeySet;
  jwksCacheTime = now;

  return jwksCache;
}

// Validate a Supabase JWT and return the user ID
export async function validateToken(token: string): Promise<string> {
  const jwks = await getJWKS();

  // Create a local JWKS from the cached keys
  const getKey = jose.createLocalJWKSet(jwks);

  // Verify the token
  const { payload } = await jose.jwtVerify(token, getKey, {
    issuer: `${SUPABASE_URL}/auth/v1`,
  });

  // Extract user ID from 'sub' claim
  const userId = payload.sub;
  if (!userId) {
    throw new Error("Token missing 'sub' claim");
  }

  return userId;
}

// Extract Bearer token from Authorization header
export function extractBearerToken(req: Request): string | null {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return null;
  }

  const parts = authHeader.split(" ");
  if (parts.length !== 2 || parts[0].toLowerCase() !== "bearer") {
    return null;
  }

  return parts[1];
}

// Auth middleware - validates token and returns user ID or null
export async function authenticateRequest(req: Request): Promise<string | null> {
  const token = extractBearerToken(req);
  if (!token) {
    return null;
  }

  try {
    return await validateToken(token);
  } catch (err) {
    console.error("Auth error:", err);
    return null;
  }
}
