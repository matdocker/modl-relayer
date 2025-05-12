FROM node:18

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

EXPOSE 8080
# Use the environment variable PORT if it is set, otherwise default to 8080

CMD ["npm", "start"]
