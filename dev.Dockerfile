FROM node:lts-alpine
ENV NODE_ENV=dev
WORKDIR /app
COPY package.json package-lock.json npm-shrinkwrap.json* ./
RUN npm install -g nodemon && npm install
CMD ["nodemon", "--inspect=0.0.0.0:9229", "--watch", "src", "--watch", "config", "src/main.js"]