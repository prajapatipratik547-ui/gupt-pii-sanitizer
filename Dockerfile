# Gupt on Google Cloud Run: a static site, so the container only serves files.
# Deploy:  gcloud run deploy gupt --source . --region asia-south1 --allow-unauthenticated

# 1. Build stage: the same typecheck + production build that CI runs.
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
# Turn the build's _headers file (generated from the CSP in vite.config.ts) into nginx
# directives, so the HTTP headers and the <meta> CSP can never drift apart.
RUN npm run build \
 && sed -n 's/^  \([A-Za-z-]*\): \(.*\)$/add_header \1 "\2" always;/p' dist/_headers > security-headers.conf \
 && grep -q "frame-ancestors 'none'" security-headers.conf \
 && rm dist/_headers

# 2. Runtime stage: static files only, served by nginx as a non-root user. No Node, no app server.
FROM nginxinc/nginx-unprivileged:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/security-headers.conf /etc/nginx/security-headers.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 8080
