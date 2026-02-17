FROM nginx:alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY index.html /usr/share/nginx/html/
COPY manifest.json /usr/share/nginx/html/
COPY sw.js /usr/share/nginx/html/
RUN mkdir -p /usr/share/nginx/html/icons
COPY icon-192.png /usr/share/nginx/html/icons/
COPY icon-512.png /usr/share/nginx/html/icons/
EXPOSE 80
