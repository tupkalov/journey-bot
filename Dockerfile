FROM node:lts-alpine
RUN apk add curl
ENV NODE_ENV=dev
WORKDIR /app
COPY package.json package-lock.json npm-shrinkwrap.json* ./
RUN npm install
COPY ./src ./src
HEALTHCHECK --interval=5m --timeout=3s CMD curl -f http://localhost:3003/health || exit 1
CMD ["node", "src/main.js"]