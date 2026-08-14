# ─────────────────────────────────────────────────────────────
#  Ω OMEGATRADE ULTRA — static SPA container
#  Build:  docker build -t omegatrade-ultra .
#  Run:    docker run -p 8080:80 omegatrade-ultra
# ─────────────────────────────────────────────────────────────
FROM oven/bun:1 AS build
WORKDIR /app
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile
COPY . .
RUN bun run build

FROM nginx:1.27-alpine AS serve
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
