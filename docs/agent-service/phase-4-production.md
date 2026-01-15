# Phase 4: Production Hardening

## Goal

Make the agent system production-ready with reconnection handling, rate limiting, usage tracking, and monitoring.

## Prerequisites

- Phase 1-3 complete (all agents working)

## Scope

- Go backend WebSocket reconnection
- Rate limiting (in Go backend)
- Usage tracking and billing
- Error recovery
- Monitoring and logging

---

## Architecture Reminder

```
Frontend
    │
    │ WebSocket: /projects/:id/agent/:agent
    ▼
Go Backend (handles reconnection, rate limiting, auth)
    │
    │ SSH → bun /opt/agent-service/src/cli.ts <agent>
    ▼
Project VM
    └── Agent CLI (stateless)
```

**Key insight**: Production features go in Go backend, not the CLI. The CLI stays simple and stateless.

---

## 1. WebSocket Reconnection (Go Backend)

### Server-Side: Connection Tracking

```go
// backend/handlers/agent.go

type agentConnection struct {
    projectID string
    userID    string
    agent     string
    sshConn   *ssh.Client
    stdin     io.WriteCloser
    createdAt time.Time
}

var activeConnections = sync.Map{} // projectID -> *agentConnection

func (h *Handler) HandleAgent(w http.ResponseWriter, r *http.Request) {
    // ... auth and setup ...

    // Check for existing connection
    connKey := fmt.Sprintf("%s:%s", projectID, userID)
    if existing, ok := activeConnections.Load(connKey); ok {
        conn := existing.(*agentConnection)
        // Reuse existing SSH session if still alive
        if conn.sshConn != nil {
            // Proxy to existing connection
        }
    }

    // ... new connection logic ...

    // Store connection
    activeConnections.Store(connKey, &agentConnection{
        projectID: projectID,
        userID:    userID,
        agent:     agent,
        sshConn:   sshSession,
        stdin:     stdin,
        createdAt: time.Now(),
    })

    defer activeConnections.Delete(connKey)
}
```

### Client-Side: Auto-Reconnect

```typescript
// In useAgentConnection hook (already in Phase 2)

const reconnectAttempts = useRef(0);
const maxReconnectAttempts = 5;
const reconnectDelays = [1000, 2000, 5000, 10000, 30000];

ws.onclose = () => {
  setIsConnected(false);

  if (reconnectAttempts.current < maxReconnectAttempts) {
    const delay = reconnectDelays[reconnectAttempts.current];
    reconnectAttempts.current++;

    setTimeout(() => connect(), delay);
  }
};

ws.onopen = () => {
  setIsConnected(true);
  reconnectAttempts.current = 0;
};
```

---

## 2. Rate Limiting (Go Backend)

### Redis-Based Rate Limiter

```go
// backend/ratelimit/ratelimit.go

package ratelimit

import (
    "context"
    "fmt"
    "time"

    "github.com/redis/go-redis/v9"
)

type Limiter struct {
    redis *redis.Client
}

func NewLimiter(redis *redis.Client) *Limiter {
    return &Limiter{redis: redis}
}

// CheckLimit returns true if request is allowed
func (l *Limiter) CheckLimit(ctx context.Context, userID string) (bool, time.Duration, error) {
    key := fmt.Sprintf("ratelimit:agent:%s", userID)

    // 60 requests per minute
    limit := int64(60)
    window := time.Minute

    count, err := l.redis.Incr(ctx, key).Result()
    if err != nil {
        return false, 0, err
    }

    if count == 1 {
        l.redis.Expire(ctx, key, window)
    }

    if count > limit {
        ttl, _ := l.redis.TTL(ctx, key).Result()
        return false, ttl, nil
    }

    return true, 0, nil
}
```

### Apply in Agent Handler

```go
// In HandleAgent

case "prompt":
    allowed, retryAfter, err := h.rateLimiter.CheckLimit(ctx, userID)
    if err != nil {
        // Log error but allow request (fail open)
        log.Error("rate limit check failed", "error", err)
    } else if !allowed {
        conn.WriteJSON(map[string]interface{}{
            "type":       "error",
            "error":      "Rate limited. Please wait before sending another message.",
            "code":       "rate_limit",
            "retryAfter": retryAfter.Milliseconds(),
        })
        return
    }
    // ... continue with prompt
```

---

## 3. Usage Tracking

### Track in Go Backend

```go
// backend/usage/usage.go

type UsageRecord struct {
    UserID      string    `json:"user_id"`
    ProjectID   string    `json:"project_id"`
    Agent       string    `json:"agent"`
    InputTokens int       `json:"input_tokens"`
    OutputTokens int      `json:"output_tokens"`
    Cost        float64   `json:"cost"`
    Timestamp   time.Time `json:"timestamp"`
}

func (s *UsageService) RecordUsage(ctx context.Context, record UsageRecord) error {
    // Store in Redis for fast access
    dayKey := fmt.Sprintf("usage:daily:%s:%s", record.UserID, time.Now().Format("2006-01-02"))

    pipe := s.redis.Pipeline()
    pipe.HIncrByFloat(ctx, dayKey, "cost", record.Cost)
    pipe.HIncrBy(ctx, dayKey, "input_tokens", int64(record.InputTokens))
    pipe.HIncrBy(ctx, dayKey, "output_tokens", int64(record.OutputTokens))
    pipe.Expire(ctx, dayKey, 90*24*time.Hour)
    _, err := pipe.Exec(ctx)

    return err
}

func (s *UsageService) GetMonthlyUsage(ctx context.Context, userID string) (*MonthlyUsage, error) {
    // Sum up daily totals for current month
    pattern := fmt.Sprintf("usage:daily:%s:%s-*", userID, time.Now().Format("2006-01"))
    keys, _ := s.redis.Keys(ctx, pattern).Result()

    var total MonthlyUsage
    for _, key := range keys {
        data, _ := s.redis.HGetAll(ctx, key).Result()
        total.Cost += parseFloat(data["cost"])
        total.InputTokens += parseInt(data["input_tokens"])
        total.OutputTokens += parseInt(data["output_tokens"])
    }

    return &total, nil
}
```

### Parse Usage from Agent Response

```go
// In agent handler, when receiving "done" message

type DoneMessage struct {
    Type  string `json:"type"`
    Agent string `json:"agent"`
    Usage *struct {
        InputTokens  int     `json:"inputTokens"`
        OutputTokens int     `json:"outputTokens"`
        Cost         float64 `json:"cost"`
    } `json:"usage,omitempty"`
}

// When forwarding messages from agent
if msg.Type == "done" && msg.Usage != nil {
    h.usage.RecordUsage(ctx, UsageRecord{
        UserID:       userID,
        ProjectID:    projectID,
        Agent:        agent,
        InputTokens:  msg.Usage.InputTokens,
        OutputTokens: msg.Usage.OutputTokens,
        Cost:         msg.Usage.Cost,
        Timestamp:    time.Now(),
    })
}
```

---

## 4. Error Recovery

### Agent CLI Error Handling

```typescript
// In cli.ts - wrap the main loop

process.on("uncaughtException", (err) => {
  send({ type: "error", agent, error: `Uncaught: ${err.message}` });
  process.exit(1);
});

process.on("unhandledRejection", (err) => {
  send({ type: "error", agent, error: `Unhandled: ${String(err)}` });
  process.exit(1);
});

// Timeout for long-running queries
const QUERY_TIMEOUT = 5 * 60 * 1000; // 5 minutes

async function handleMessage(msg: ClientMessage) {
  const timeout = setTimeout(() => {
    send({ type: "error", agent, error: "Query timed out" });
    provider.abort();
  }, QUERY_TIMEOUT);

  try {
    // ... handle message
  } finally {
    clearTimeout(timeout);
  }
}
```

### Go Backend Retry Logic

```go
// Retry SSH connection on transient failures

func (h *Handler) connectWithRetry(ip string, maxAttempts int) (*ssh.Client, error) {
    var lastErr error

    for i := 0; i < maxAttempts; i++ {
        conn, err := h.sshClient.Connect(ip, 2222)
        if err == nil {
            return conn, nil
        }

        lastErr = err
        time.Sleep(time.Duration(i+1) * time.Second)
    }

    return nil, fmt.Errorf("failed after %d attempts: %w", maxAttempts, lastErr)
}
```

---

## 5. Monitoring & Logging

### Structured Logging (Agent CLI)

```typescript
// src/utils/logger.ts

type LogLevel = "debug" | "info" | "warn" | "error";

function log(level: LogLevel, message: string, data?: Record<string, unknown>) {
  // Log to stderr so it doesn't interfere with stdout JSON protocol
  console.error(
    JSON.stringify({
      level,
      message,
      timestamp: new Date().toISOString(),
      ...data,
    })
  );
}

export const logger = {
  debug: (msg: string, data?: Record<string, unknown>) => log("debug", msg, data),
  info: (msg: string, data?: Record<string, unknown>) => log("info", msg, data),
  warn: (msg: string, data?: Record<string, unknown>) => log("warn", msg, data),
  error: (msg: string, data?: Record<string, unknown>) => log("error", msg, data),
};
```

### Go Backend Metrics

```go
// backend/metrics/metrics.go

var (
    agentConnections = prometheus.NewGaugeVec(
        prometheus.GaugeOpts{
            Name: "agent_active_connections",
            Help: "Number of active agent connections",
        },
        []string{"agent"},
    )

    agentQueryDuration = prometheus.NewHistogramVec(
        prometheus.HistogramOpts{
            Name:    "agent_query_duration_seconds",
            Help:    "Time spent processing agent queries",
            Buckets: []float64{1, 5, 10, 30, 60, 120, 300},
        },
        []string{"agent"},
    )

    agentErrors = prometheus.NewCounterVec(
        prometheus.CounterOpts{
            Name: "agent_errors_total",
            Help: "Total number of agent errors",
        },
        []string{"agent", "error_type"},
    )
)
```

### Health Check

```go
// backend/handlers/health.go

func (h *Handler) HealthCheck(w http.ResponseWriter, r *http.Request) {
    status := "healthy"
    checks := map[string]bool{
        "redis": h.redis.Ping(r.Context()).Err() == nil,
        "db":    h.db.Ping(r.Context()) == nil,
    }

    for _, ok := range checks {
        if !ok {
            status = "degraded"
            break
        }
    }

    json.NewEncoder(w).Encode(map[string]interface{}{
        "status": status,
        "checks": checks,
        "uptime": time.Since(startTime).Seconds(),
    })
}
```

---

## 6. VM Image Updates

### Supervisor for Agent Process

Since the CLI is invoked per-request via SSH, no persistent process needed. But ensure the VM has:

```dockerfile
# In VM Dockerfile

# Install Bun
RUN curl -fsSL https://bun.sh/install | bash

# Copy agent service
COPY agent-service /opt/agent-service
WORKDIR /opt/agent-service
RUN bun install --production

# Back to default workdir
WORKDIR /home/coder
```

### Environment Variables

Set in VM startup:

```bash
# Injected by Go backend or from user's stored API keys
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...
```

---

## Success Criteria

1. Clients reconnect automatically after disconnect
2. Rate limiting prevents abuse (60 req/min per user)
3. Usage is tracked per user/project
4. Errors don't crash the system
5. Logs are structured and queryable
6. Health checks pass in production

---

## Monitoring Checklist

- [ ] Prometheus metrics exposed on Go backend
- [ ] Grafana dashboard for agent usage
- [ ] Alerts for high error rate
- [ ] Alerts for high latency (p95 > 30s)
- [ ] Redis memory monitoring
- [ ] SSH connection failure alerts
