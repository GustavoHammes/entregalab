FROM node:22-alpine AS build
WORKDIR /repo
COPY package.json package-lock.json ./
COPY apps/api/package.json ./apps/api/package.json
COPY apps/web/package.json ./apps/web/package.json
RUN npm ci
COPY apps ./apps
COPY database ./database
RUN npm run build

FROM node:22-alpine AS production
ENV NODE_ENV=production PORT=3333 WEB_DIR=/repo/apps/web/dist
WORKDIR /repo
COPY package.json package-lock.json ./
COPY apps/api/package.json ./apps/api/package.json
COPY apps/web/package.json ./apps/web/package.json
RUN npm ci --workspace @entregalab/api --omit=dev && npm cache clean --force
COPY --from=build /repo/apps/api/dist ./apps/api/dist
COPY --from=build /repo/apps/web/dist ./apps/web/dist
COPY database ./database
USER node
EXPOSE 3333
CMD ["node", "apps/api/dist/server.js"]
