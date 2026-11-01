# Image de production : construit l'application puis la sert avec server/server.mjs.
#
#   docker build -t inventaire-botanique .
#   docker run -p 8080:8080 -v ./data:/data -e PUBLISH_PASSWORD=change-moi inventaire-botanique

FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY src ./src
COPY scripts ./scripts
RUN npm run build

FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=8080 ROOT=/app/dist DATA_DIR=/data
COPY --from=build /app/dist ./dist
COPY server ./server
RUN mkdir -p /data && chown -R node:node /data
USER node
EXPOSE 8080
VOLUME ["/data"]
CMD ["node", "server/server.mjs"]
