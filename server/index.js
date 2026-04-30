import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import dotenv from 'dotenv';
import chatRoutes from './src/routes/chatRoutes.js';
import adminRoutes from './src/routes/adminRoutes.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 4000;

// ==========================================
// CONFIGURACIÓN DE ORIGINS PERMITIDOS
// ==========================================

const allowedOrigins = [
  'https://reservas.tonav-tech.online',
  'https://localhost:4000',
   'https://localhost:5173'
];,


// ==========================================
// CONFIGURACIÓN DE CORS 
// ==========================================
const corsOptions = {
  origin: function(origin, callback) {
    
    if (!origin) {
      return callback(null, true);
    }
    
    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    
  
    if (process.env.NODE_ENV === 'development') {
      console.warn(`CORS bloqueado para origen: ${origin}`);
    }
    
    return callback(new Error('CORS no permitido'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: [
    'Content-Type',
    'Authorization',
    'X-Requested-With',
    'Accept',
    'Origin',
    'Access-Control-Request-Method',
    'Access-Control-Request-Headers',
    'Bypass-Tunnel-Reminder'
  ],
  exposedHeaders: ['Content-Length', 'X-JSON-Response'],
  maxAge: 86400 
};

// Aplicar CORS globalmente
app.use(cors(corsOptions));

// ==========================================
// MANEJO EXPLÍCITO DE PREFLIGHT (OPTIONS)
// ==========================================
app.options('*', cors(corsOptions));


// ==========================================
// MIDDLEWARES
// ==========================================
app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ limit: '50mb', extended: true }));

// Middleware para loguear requests en desarrollo
if (process.env.NODE_ENV === 'development') {
  app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
    console.log(`Origin: ${req.headers.origin}`);
    next();
  });
}

// ==========================================
// DEFINICIÓN DE ENDPOINTS
// ==========================================
app.use('/api/chat', chatRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/upload', uploadRoutes);

app.get('/', (req, res) => {
  res.send('Limenita backend running');
});

// ==========================================
// MANEJO DE ERRORES
// ==========================================
app.use((err, req, res, next) => {
  // Error de CORS
  if (err.message === 'CORS no permitido') {
    return res.status(403).json({
      error: 'CORS Error',
      message: 'El origen de tu request no está permitido'
    });
  }
  
  console.error('Error:', err);
  res.status(500).json({ error: 'Error interno del servidor' });
});

// ==========================================
// INICIAR SERVIDOR
// ==========================================
app.listen(PORT,"0.0.0.0",() => {
  console.log(`✓ Server running on port ${PORT}`);
  console.log(`✓ Allowed origins:`, allowedOrigins);
  console.log(`✓ Environment: ${process.env.NODE_ENV || 'development'}`);
});