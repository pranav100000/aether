# Environment Variables

This document describes all environment variables used by the Aether API.

## Required (Production)

| Variable           | Description                             |
| ------------------ | --------------------------------------- |
| `DATABASE_URL`     | PostgreSQL connection string            |
| `SUPABASE_URL`     | Supabase project URL for authentication |
| `FLY_API_TOKEN`    | Fly.io API token for VM management      |
| `FLY_VMS_APP_NAME` | Fly.io app name for VMs                 |

## Required (Local Mode)

| Variable           | Description                                                                  |
| ------------------ | ---------------------------------------------------------------------------- |
| `LOCAL_MODE=true`  | Enable local Docker mode instead of Fly.io                                   |
| `LOCAL_BASE_IMAGE` | Docker image to use for workspaces (e.g., `pranav100000/aether-base:latest`) |

## Optional

| Variable                      | Default                             | Description                                                                                 |
| ----------------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------- |
| `API_PORT`                    | `8080`                              | HTTP server port                                                                            |
| `FLY_REGION`                  | `sjc`                               | Default Fly.io region for new VMs                                                           |
| `BASE_IMAGE`                  | `registry.fly.io/{app}/base:latest` | Docker image for production workspaces                                                      |
| `IDLE_TIMEOUT_MINUTES`        | `10`                                | VM idle timeout before auto-stop                                                            |
| `ENCRYPTION_MASTER_KEY`       | -                                   | 32-byte hex key (64 chars) for API key encryption. If not set, API keys feature is disabled |
| `SUPABASE_JWT_SECRET`         | -                                   | JWT secret for local development (HS256 fallback)                                           |
| `SENTRY_DSN`                  | -                                   | Sentry error tracking DSN. If not set, Sentry is disabled                                   |
| `ENVIRONMENT`                 | -                                   | Environment name for Sentry (e.g., `production`, `staging`)                                 |
| `VERSION`                     | `dev`                               | Version string for health endpoint                                                          |
| `LOCAL_PROJECT_DIR`           | `/tmp/aether-project`               | Project directory path when in local mode                                                   |
| `LOCAL_WORKSPACE_SERVICE_DIR` | -                                   | Path to workspace-service source for local development                                      |

## Validation Rules

The API validates configuration at startup and will:

- **Fail** if `DATABASE_URL` or `SUPABASE_URL` is missing
- **Fail** if `LOCAL_MODE=true` and `LOCAL_BASE_IMAGE` is missing
- **Fail** if `LOCAL_MODE` is not set and `FLY_API_TOKEN` or `FLY_VMS_APP_NAME` is missing
- **Fail** if `ENCRYPTION_MASTER_KEY` is set but not exactly 64 hex characters
- **Warn** if `FLY_API_TOKEN` is set but `LOCAL_MODE=true` (token will be ignored)
- **Warn** if `IDLE_TIMEOUT_MINUTES` is set but not a valid integer (will use default)

## Configuration Conflicts

- `FLY_API_TOKEN` is ignored when `LOCAL_MODE=true`
- GPU machines are always created in `ord` region regardless of `FLY_REGION`
