FROM node:22-alpine
WORKDIR /app
COPY . .
ENV PORT=3000 PUFFWATT_ENV=development PUFFWATT_DB=/data/puffwatt.sqlite
VOLUME /data
EXPOSE 3000
CMD ["node","server/index.js"]
