FROM node:18-alpine

# Build dependencies for better-sqlite3
RUN apk add --no-cache python3 make g++

WORKDIR /app

# Server függőségek
COPY server/package*.json ./server/
WORKDIR /app/server
RUN npm install

# Vissza a fő mappába
WORKDIR /app
COPY . .

# Adatbázis könyvtár
RUN mkdir -p /app/server/data

EXPOSE 3001

WORKDIR /app/server
CMD ["node", "server.js"]
