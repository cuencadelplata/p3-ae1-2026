# syntax=docker/dockerfile:1
FROM node:22-alpine

LABEL org.opencontainers.image.title="m8-m7-payments-sandbox" \
      org.opencontainers.image.description="API de pagos de M7 simulada para el servicio de comprobantes (AE2)"

WORKDIR /app
COPY server.mjs ./

USER node

ENV PORT=4020
EXPOSE 4020

HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4020)+'/admin/mode').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.mjs"]
