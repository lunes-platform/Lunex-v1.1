FROM node:20-alpine
WORKDIR /app
# package-lock.json is gitignored repo-wide: use it when present, else resolve.
COPY package*.json ./
RUN if [ -f package-lock.json ]; then npm ci --omit=dev; else npm install --omit=dev; fi \
  && npm cache clean --force
COPY index.js ./
COPY src ./src
COPY abis ./abis
COPY public ./public
ENV NODE_ENV=production
EXPOSE 3333
USER node
CMD ["node", "index.js"]
