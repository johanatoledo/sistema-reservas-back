import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import dotenv from 'dotenv';

// Importación de Rutas
impcaort chatRoutes from './src/routes/chatRoutes.js';
import adminRoutes from './src/routes/adminRoutes.js';
import uploadRoutes from './src/routes/uploadRoutes.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 4000;

// ==========================================
// CONFIGURACIÓN DE ORIGINS PERMITIDOS
// ==========================================


const allowedOrigins = [
  (process.env.ALLOWED_ORIGINS || '').split(',').filter(Boolean),
  // Para desarrollo local (si es necesario)
  ...(process.env.NODE_ENV === 'development' ? [
    'http://localhost:4000',
    'http://127.0.0.1:4000'
  ] : [])
];

// ==========================================
// CONFIGURACIÓN DE CORS - OPCIÓN RECOMENDADA
// ==========================================
const corsOptions = {
  origin: function(origin, callback) {
    // Permitir peticiones sin origen (Postman, curl, requests internos)
    if (!origin) {
      return callback(null, true);
    }
    
    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    
    // Log para debugging en desarrollo
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
  maxAge: 86400 // 24 horas - cachea las respuestas preflight
};

// Aplicar CORS globalmente
app.use(cors(corsOptions));

// ==========================================
// MANEJO EXPLÍCITO DE PREFLIGHT (OPTIONS)
// ==========================================
app.options('*', cors(corsOptions));

// Alternativa manual si quieres mayor control:
/*
app.options('*', (req, res) => {
  const origin = req.headers.origin;
  
  if (!origin || allowedOrigins.includes(origin)) {
    res.header('Access-Control-Allow-Origin', origin || '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, Accept');
    res.header('Access-Control-Allow-Credentials', 'true');
    res.header('Access-Control-Max-Age', '86400');
  }
  
  return res.sendStatus(200);
});
*/

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