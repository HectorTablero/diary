FROM node:24-alpine AS build
WORKDIR /app
COPY package*.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build

FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
COPY shared/package.json shared/
COPY server/package.json server/
RUN npm ci --omit=dev --no-audit --no-fund -w server --ignore-scripts
COPY --from=build /app/server/dist server/dist
COPY --from=build /app/web/dist web/dist
EXPOSE 3000
CMD ["node", "server/dist/index.js"]
