# Usa una imagen de Node estable
FROM node:20

# Crea la carpeta de trabajo dentro del contenedor
WORKDIR /app

# Copia los archivos de dependencias
COPY package*.json ./

# Instala las dependencias
RUN npm install

# Copia el resto del código del backend
COPY . .

# Expone el puerto que usa tu API
EXPOSE 5000

# Comando para iniciar el servidor
CMD ["npm", "start"]