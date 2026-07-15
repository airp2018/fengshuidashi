FROM node:18-alpine

WORKDIR /app

# Copy package files and install dependencies
COPY package*.json ./
RUN npm install --production

# Copy all files (respecting .gitignore)
COPY . .

# Hugging Face Spaces requires port 7860
EXPOSE 7860
ENV PORT=7860

CMD ["node", "server.js"]
