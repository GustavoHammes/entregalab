FROM node:22-alpine

WORKDIR /repo

COPY package.json package-lock.json ./
COPY apps/api/package.json ./apps/api/package.json
COPY apps/web/package.json ./apps/web/package.json
RUN npm ci --workspace @entregalab/api

COPY apps/api/tsconfig.json ./apps/api/tsconfig.json
COPY apps/api/src ./apps/api/src
COPY database ./database

WORKDIR /repo/apps/api

EXPOSE 3333

CMD ["npm", "run", "dev"]
