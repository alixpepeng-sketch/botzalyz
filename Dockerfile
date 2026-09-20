# Opsional. Dipakai kalau di Render memilih runtime Docker.
# Memasang ffmpeg (sticker video) dan font (agar teks .brat tampil benar).
FROM node:20-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends git ca-certificates ffmpeg fontconfig fonts-dejavu-core fonts-liberation \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev --omit=optional
COPY . .

ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "index.js"]
