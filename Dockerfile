# Multi-stage build for the API and the job worker — ONE image, two
# entrypoints, matching the process topology in 03_SYSTEM_ARCHITECTURE §2.
# The Voice Gateway becomes a third entrypoint from this same image at Phase 5.
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
RUN pnpm --filter @platform/api build

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build /app /app
# Never run as root.
USER node
EXPOSE 3001
CMD ["node", "apps/api/dist/main.js"]
