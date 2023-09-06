FROM node:lts-alpine
ENV NODE_ENV=dev
WORKDIR /app
COPY package.json package-lock.json npm-shrinkwrap.json* ./
RUN npm install
COPY ./src ./src
CMD ["node", "src/main.js"]