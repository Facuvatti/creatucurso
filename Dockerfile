# One image for the web server and the worker (compose picks the command).
# Build:  docker build -t creatucurso .
FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml ./

# Production dependencies only. Kept at runtime because the worker runs from
# source and the server build leaves @sentry/* external (see vite.config.ts).
FROM base AS prod-deps
RUN pnpm install --frozen-lockfile --prod

FROM base AS build
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

FROM node:22-bookworm-slim AS runtime
# ffmpeg: the worker encodes uploaded videos (ADR-0019) and re-encodes certificate
# frames; poppler-utils flattens a PDF frame (ADR-0025).
RUN apt-get update \
	&& apt-get install -y --no-install-recommends ffmpeg poppler-utils \
	&& rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000
WORKDIR /app
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/.output ./.output
COPY package.json ./
COPY src ./src
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
	CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
# Web server. The worker overrides this command in infra/app/compose.yaml.
CMD ["node", ".output/server/index.mjs"]
