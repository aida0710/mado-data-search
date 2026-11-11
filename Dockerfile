# APIと取り込みの処理で同じイメージを使う。画面はビルドしてAPIが配る。
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/contracts/package.json packages/contracts/
RUN npm ci --no-audit --no-fund
COPY apps apps
COPY packages packages
RUN npm run build -w @mds/contracts && npm run build -w @mds/api && npm run build -w @mds/web

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/contracts/package.json packages/contracts/
RUN npm ci --omit=dev --workspace @mds/api --workspace @mds/contracts --no-audit --no-fund
COPY --from=build /app/apps/api/dist apps/api/dist
COPY --from=build /app/packages/contracts/dist packages/contracts/dist
COPY --from=build /app/apps/web/dist apps/web/dist
ENV MDS_WEB_DIRECTORY=/app/apps/web/dist
ENV MDS_SOURCES_FILE=/config/sources.yaml
USER node
CMD ["node", "--conditions=compiled", "apps/api/dist/server.js"]
