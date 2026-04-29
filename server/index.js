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


const allowedOrigins = [
  'https://reservas.tonav-tech.online'
];

// 1. Configuración dinámica de CORS
app.use(cors({
  origin: function(origin, callback) {
    // Permitir peticiones sin origen (como Postman o curl)
    if (!origin) return callback(null, true);
    
    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    } else {
      return callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Bypass-Tunnel-Reminder']
}));

// 2. Manejo explícito de Preflight (OPTIONS)
// IMPORTANTE: Agregamos '*' para que capture todas las rutas
app.options('*', (req, res) => {
  const origin = req.headers.origin;
  
  // Si el origen está permitido, lo devolvemos en el header
  if (allowedOrigins.includes(origin)) {
    res.header('Access-Control-Allow-Origin', origin);
  }
  
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, Bypass-Tunnel-Reminder');
  res.header('Access-Control-Allow-Credentials', 'true');
  res.sendStatus(200);
});


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