FROM golang:1.24-alpine AS builder

WORKDIR /app

RUN apk add --no-cache git

COPY go.mod go.sum ./
RUN go mod download

COPY apps/api/ ./apps/api/
COPY libs/go/ ./libs/go/

RUN CGO_ENABLED=0 GOOS=linux go build -o server ./apps/api

FROM alpine:3.19

RUN apk add --no-cache ca-certificates

WORKDIR /app

COPY --from=builder /app/server .

EXPOSE 8080

CMD ["./server"]
