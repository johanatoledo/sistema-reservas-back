import express from 'express';
import multer from 'multer';
import path from 'path';

const router = express.Router();

// Configuración de almacenamiento
const storage = multer.diskStorage({
  destination: 'uploads/',
  filename: (req, file, cb) => {
    // Usamos Date.now() para evitar archivos duplicados
    cb(null, `${Date.now()}-${file.originalname}`);
  }
});

const upload = multer({ 
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // Límite de 5MB por seguridad
});

// Definimos la ruta POST
router.post('/', upload.single('invitados'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ success: false, message: 'No se subió ningún archivo.' });
  }
  
  res.json({
    success: true,
    fileName: req.file.filename,
    path: `/uploads/${req.file.filename}` // Útil para previsualización
  });
});

export default router;