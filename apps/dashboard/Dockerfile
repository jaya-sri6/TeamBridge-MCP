FROM node:22.23.3-alpine AS builder
WORKDIR /app
COPY package.json tsconfig.json vite.config.ts index.html ./
RUN npm install
COPY src ./src
RUN npm run build

FROM nginx:1.27-alpine AS runner
COPY --from=builder /app/dist /usr/share/nginx/html
RUN echo 'server { \
    listen 80; \
    location / { \
        root /usr/share/nginx/html; \
        try_files $uri $uri/ /index.html; \
    } \
    location /api/ { \
        proxy_pass http://gateway:3000/api/; \
    } \
    location /mcp { \
        proxy_pass http://gateway:3000/mcp; \
    } \
}' > /etc/nginx/conf.d/default.conf

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
