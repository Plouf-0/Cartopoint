# Image de production : construit l'application puis la sert avec server/server.mjs.
#
#   docker build -t inventaire-botanique .
#   docker run -p 8080:8080 -v ./data:/data -e PUBLISH_PASSWORD=change-moi inventaire-botanique

FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY src ./src
COPY scripts ./scripts
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=8080 ROOT=/app/dist DATA_DIR=/data
COPY --from=build /app/dist ./dist
COPY server ./server
# Projet d'exemple, utilisé seulement si le volume /data est vide au premier démarrage
COPY data/project.json ./seed/project.json
RUN mkdir -p /data && chown -R node:node /data
USER node
EXPOSE 8080
VOLUME ["/data"]
CMD ["sh", "-c", "[ -f /data/project.json ] || cp /app/seed/project.json /data/; exec node server/server.mjs"]
