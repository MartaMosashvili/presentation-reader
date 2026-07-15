FROM node:20-slim

# LibreOffice for pptx->pdf conversion + fonts (incl. Georgian glyph coverage)
RUN apt-get update && apt-get install -y --no-install-recommends \
    libreoffice-impress \
    fonts-noto-core \
    fonts-dejavu-core \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "server.js"]
