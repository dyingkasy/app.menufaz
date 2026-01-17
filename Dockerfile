FROM node:20-alpine AS builder

WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install
COPY . .

ARG VITE_API_BASE_URL
ARG VITE_IMAGEKIT_PUBLIC_KEY
ARG VITE_IMAGEKIT_URL_ENDPOINT
ARG VITE_IMAGEKIT_FOLDER

ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
ENV VITE_IMAGEKIT_PUBLIC_KEY=$VITE_IMAGEKIT_PUBLIC_KEY
ENV VITE_IMAGEKIT_URL_ENDPOINT=$VITE_IMAGEKIT_URL_ENDPOINT
ENV VITE_IMAGEKIT_FOLDER=$VITE_IMAGEKIT_FOLDER

RUN npm run build

FROM nginx:1.27-alpine
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/dist /usr/share/nginx/html

EXPOSE 8080
CMD ["nginx", "-g", "daemon off;"]
