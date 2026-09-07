# Install dependencies
FROM oven/bun:1.4-alpine AS deps
WORKDIR /app

COPY package.json ./

RUN bun install


# Build
FROM oven/bun:1.4-alpine AS builder
WORKDIR /app

COPY . .
COPY --from=deps /app/node_modules ./node_modules

ENV STANDALONE=1
RUN bun run build


# Production: distroless, bun binary plus glibc, no shell, no root. bun install
# ships the gnu native bindings next to the musl ones, so the alpine build runs
# on glibc unchanged. Every runtime setting comes from the pod Secret, so the
# dotenvx wrapper in `bun start` is not needed here.
FROM oven/bun:1.4 AS libs
RUN T=$(uname -m)-linux-gnu && mkdir -p /out/$T && \
    cp -L /lib/$T/libgcc_s.so.1 /usr/lib/$T/libstdc++.so.6 /out/$T/

FROM oven/bun:1.4-distroless AS prod
WORKDIR /app
# the distroless bun image has neither libgcc nor libstdc++; native bindings dlopen both
COPY --from=libs /out/ /usr/lib/

COPY --from=builder --chown=1001:1001 /app/dist ./dist
COPY --from=builder --chown=1001:1001 /app/node_modules ./node_modules
COPY --from=builder --chown=1001:1001 /app/package.json ./package.json
COPY --from=builder --chown=1001:1001 /app/drizzle ./drizzle

ENV DOCKER=true
ENV NODE_ENV=production

USER 1001:1001

CMD ["dist/main.js"]
