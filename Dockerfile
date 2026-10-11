# Stage 1: Build frontend
FROM node:20-alpine AS frontend-build
ENV NODE_OPTIONS=--max-old-space-size=4096
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN node --version && npm --version
RUN npm run build

# Stage 2: Build backend
FROM node:20-alpine AS backend-build
RUN apk add --no-cache python3 make g++
WORKDIR /app/backend
COPY backend/package*.json ./
RUN npm ci
COPY backend/ ./
RUN npm run build

# Stage 2b: Extract SAP assets (public Apple binaries, digest-pinned)
# Downloads the public Apple update package once (~380 MB over range
# requests), verifies the pinned digests, strips fat binaries to their x86_64
# slices, and emits ~22.5 MB of assets. Docker layer caching makes this a
# no-op on rebuilds unless the pinned digests change.
FROM --platform=$BUILDPLATFORM node:20-alpine AS sap-assets
WORKDIR /app/backend
COPY --from=backend-build /app/backend ./
ARG SAP_ASSETS_OUT=/out
RUN DATA_DIR=/tmp/sap-extract-work node --import tsx scripts/extract-sap-assets.mts ${SAP_ASSETS_OUT}

# Stage 3: Runtime
FROM node:20-alpine
RUN apk add --no-cache zip
WORKDIR /app
COPY --from=backend-build /app/backend/dist ./dist
COPY --from=backend-build /app/backend/node_modules ./node_modules
COPY --from=backend-build /app/backend/package.json ./
COPY --from=frontend-build /app/frontend/dist ./public
COPY --from=sap-assets /out /opt/asspp/sap-assets
RUN mkdir -p /data/packages
EXPOSE 8080
ARG BUILD_COMMIT=unknown
ARG BUILD_DATE=unknown
ENV DATA_DIR=/data PORT=8080 BUILD_COMMIT=$BUILD_COMMIT BUILD_DATE=$BUILD_DATE
CMD ["node", "dist/index.js"]
