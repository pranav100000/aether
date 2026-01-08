FROM golang:1.24-alpine AS builder

WORKDIR /app

# Copy backend module (shared dependency)
COPY backend/go.mod backend/go.sum ./backend/
COPY backend/ ./backend/

# Copy gateway module
COPY gateway/go.mod gateway/go.sum ./gateway/
WORKDIR /app/gateway
RUN go mod download

COPY gateway/ ./

RUN CGO_ENABLED=0 GOOS=linux go build -o gateway .

FROM alpine:3.19

RUN apk add --no-cache ca-certificates

COPY --from=builder /app/gateway/gateway /gateway

EXPOSE 8080

CMD ["/gateway"]
