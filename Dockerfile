# Multi-stage build for the API and the job worker — ONE image, two
# entrypoints, matching the process topology in 03_SYSTEM_ARCHITECTURE §2.
#
# Workspace packages export TypeScript sources for local tsx/vitest. In this
# image we compile them to dist/ and rewrite package.json exports so plain
# `node` can boot Nest without tsx (Nest parameter decorators need tsc emit).
FROM node:22-alpine AS base
ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable
WORKDIR /app

FROM base AS deps
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/db/package.json packages/db/
COPY packages/permissions/package.json packages/permissions/
COPY packages/providers/package.json packages/providers/
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY . .
RUN pnpm --filter @platform/permissions build \
 && pnpm --filter @platform/providers build \
 && pnpm --filter @platform/db build \
 && pnpm --filter @platform/api build \
 && node <<'NODE'
const fs = require('fs');
const pkgs = [
  {
    path: 'packages/permissions/package.json',
    exports: { '.': './dist/index.js' },
    main: './dist/index.js',
  },
  {
    path: 'packages/providers/package.json',
    exports: { '.': './dist/index.js' },
    main: './dist/index.js',
  },
  {
    path: 'packages/db/package.json',
    exports: { '.': './dist/index.js', './schema': './dist/schema/index.js' },
    main: './dist/index.js',
  },
];
for (const p of pkgs) {
  const j = JSON.parse(fs.readFileSync(p.path, 'utf8'));
  j.main = p.main;
  j.types = p.main.replace(/\.js$/, '.d.ts');
  j.exports = p.exports;
  fs.writeFileSync(p.path, JSON.stringify(j, null, 2) + '\n');
}
NODE

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build /app /app
USER node
EXPOSE 3001
CMD ["node", "apps/api/dist/main.js"]

# Optional web image: `docker build --target web -t platform-web:hiring .`
FROM deps AS web-build
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# Browser hits same-origin /backend; Next proxies to the API service name.
ENV API_URL=http://api:3001
RUN pnpm --filter @platform/web build

FROM base AS web
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV API_URL=http://api:3001
COPY --from=web-build /app /app
USER node
WORKDIR /app/apps/web
EXPOSE 3000
CMD ["./node_modules/.bin/next", "start", "--port", "3000"]
