# IT Demirbaş ve Zimmet — API imajı
FROM node:22-alpine

ENV NODE_ENV=production
WORKDIR /app

# Bağımlılıklar ayrı katmanda (kod değişince yeniden indirilmez).
# package-lock.json varsa birebir aynı sürümler kurulur (npm ci), yoksa npm install.
COPY package*.json ./
RUN if [ -f package-lock.json ]; then npm ci --omit=dev; else npm install --omit=dev; fi \
    && npm cache clean --force

COPY src ./src

# Root olmayan kullanıcıyla çalış
USER node
EXPOSE 3000

HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --retries=5 \
  CMD wget -qO- http://127.0.0.1:3000/health >/dev/null || exit 1

# Her açılışta: bekleyen migrationlar → ilk kurulum/güvenlik kontrolleri (idempotent, örnek veri yüklemez) → API.
# Eksik/zayıf güvenlik ayarında API başlamaz (bkz. docs/SECURITY.md §6).
CMD ["sh", "-c", "node src/scripts/migrate.js && node src/scripts/seed.js && exec node src/server.js"]
