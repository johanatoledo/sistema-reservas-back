import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import dotenv from 'dotenv';
import fs from 'fs';

// Importación de Rutas
import chatRoutes from './src/routes/chatRoutes.js';
import adminRoutes from './src/routes/adminRoutes.js';
import uploadRoutes from './src/routes/uploadRoutes.js'; // Nueva ruta

dotenv.config();

const app = express();
const PORT = process.env.PORT || 4000;

// Middlewares
app.use(cors());

// Configuración de CORS
const corsOptions = {
  origin: 'https://reservas.tonav-tech.online',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Bypass-Tunnel-Reminder'], 
  credentials: true
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions));
app.use(bodyParser.json());



// Definición de Endpoints
app.use('/api/chat', chatRoutes);
app.use('/api/admin', adminRoutes); // <--- Registro de rutas admin y corporativas
app.use('/api/upload', uploadRoutes); // <--- Registro de la ruta de subida

app.get('/', (req, res) => {
  res.send('Limenita backend running');
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});