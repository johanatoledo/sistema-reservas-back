// server/src/routes/chatRoutes.js
// Rutas para manejar las solicitudes de chat con OpenAI
import express from 'express';
import { chatController } from '../controllers/chatControllers.js';


const router = express.Router();


// ─────────────────────────────────────────────────────────
//  POST /api/chat
// ─────────────────────────────────────────────────────────
router.post('/', chatController);



export default router;