FROM node:20-alpine
WORKDIR /app
RUN mkdir -p /data && chown node:node /data
COPY package.json ./
RUN npm install --production
COPY index.js ./
EXPOSE 3333
VOLUME ["/data"]
USER node
CMD ["node", "index.js"]
