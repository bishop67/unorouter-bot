# One compiled Bun binary on distroless: no bun, no node_modules, no shell, no root.
# Every runtime value comes from the bot-env Secret; the image carries no .env.
FROM oven/bun:1.4 AS builder
WORKDIR /app
COPY package.json ./
RUN bun install
COPY . .
ARG TARGETARCH
RUN bun build --compile --production --target=bun-linux-$([ "$TARGETARCH" = arm64 ] && echo arm64 || echo x64) src/main.ts --outfile /app/bot

FROM gcr.io/distroless/cc-debian12:nonroot@sha256:9dac0a79194e45a7da0158a9c6da57b217585af0786db3845d1f0ec1a0dd182f
WORKDIR /app
ENV DOCKER=true
ENV NODE_ENV=production
COPY --from=builder --chown=nonroot:nonroot /app/bot ./bot
# drizzle migrations are read from disk at boot
COPY --from=builder --chown=nonroot:nonroot /app/drizzle ./drizzle
ENTRYPOINT ["/app/bot"]
