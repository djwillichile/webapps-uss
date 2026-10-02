# One image, two roles: the command decides whether the container is the API or a worker.
FROM node:22-alpine

ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY src ./src
COPY public ./public

# Never run as root inside the container.
USER node

CMD ["node", "src/api.js"]
