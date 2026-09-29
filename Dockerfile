FROM node:20-alpine
WORKDIR /app
COPY package.json server.js ./
COPY lib ./lib
COPY certs ./certs
COPY public ./public
ENV PORT=8787 NODE_ENV=production NODE_EXTRA_CA_CERTS=/app/certs/globalsign-intermediates.pem
USER node
EXPOSE 8787
CMD ["node", "server.js"]
