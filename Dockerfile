FROM node:lts-alpine
ENV NODE_ENV=dev
WORKDIR /app
COPY package.json package-lock.json npm-shrinkwrap.json* ./
RUN npm install && mv node_modules ../
COPY ./src ./src
RUN chown -R node /app
USER node
CMD ["node", "src/main.js"]