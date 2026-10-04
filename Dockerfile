# MAI — một artifact duy nhất: frontend + API + job runner trong một process Bun.
# Build:  docker build -t mai .
# Chạy:   docker run -p 3000:3000 -v mai-data:/data mai

FROM oven/bun:1 AS build
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .
RUN bun run build

FROM oven/bun:1-slim
WORKDIR /app
ENV MAI_DATA_DIR=/data \
    PORT=3000
# Server chỉ dùng Bun built-in (bun:sqlite, Bun.serve) → không cần node_modules lúc chạy.
COPY src ./src
COPY package.json ./
COPY --from=build /app/dist ./dist
VOLUME /data
EXPOSE 3000
CMD ["bun", "src/server/index.ts"]
