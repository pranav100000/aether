FROM golang:1.24-alpine AS builder

WORKDIR /app

COPY go.mod go.sum ./
RUN go mod download

COPY apps/gateway/ ./apps/gateway/
COPY apps/api/ ./apps/api/
COPY libs/go/ ./libs/go/

RUN CGO_ENABLED=0 GOOS=linux go build -o gateway ./apps/gateway

FROM alpine:3.19

RUN apk add --no-cache ca-certificates

COPY --from=builder /app/gateway /gateway

EXPOSE 8080

CMD ["/gateway"]
