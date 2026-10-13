FROM node:22-alpine

WORKDIR /repo

COPY package.json package-lock.json ./
COPY apps/web/package.json ./apps/web/package.json
COPY apps/api/package.json ./apps/api/package.json
RUN npm ci --workspace @entregalab/web

COPY apps/web/index.html ./apps/web/index.html
COPY apps/web/tsconfig.json ./apps/web/tsconfig.json
COPY apps/web/tsconfig.node.json ./apps/web/tsconfig.node.json
COPY apps/web/vite.config.ts ./apps/web/vite.config.ts
COPY apps/web/src ./apps/web/src

WORKDIR /repo/apps/web

EXPOSE 5173

CMD ["npm", "run", "dev"]
