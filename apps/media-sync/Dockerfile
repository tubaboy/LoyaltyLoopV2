FROM node:22-alpine

WORKDIR /app
COPY receiver.mjs ./receiver.mjs

EXPOSE 18765
CMD ["node", "receiver.mjs"]
