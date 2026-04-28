import express from 'express';
import { GuardarReserva, obtenerReservas, obtenerReservasPorFecha,actualizarEstadoPago, deleteReserva } from '../controllers/adminControllers.js';
import { guardarInvitadosCorporativos, listaInvitadosCorporativos, actualizarEstadoPagoCorporativa } from '../controllers/invitadosControllers.js';
const router = express.Router();




// ─────────────────────────────────────────────────────────
//  GET /admin/obtenerReservas
// ─────────────────────────────────────────────────────────
router.get('/reservas', obtenerReservas);

// ────────────────────────────────────────────────────────
//  POST /admin/GuardarReserva
// ─────────────────────────────────────────────────────────
router.post('/guardareserva',GuardarReserva);

// ────────────────────────────────────────────────────────
//  GET /admin/obtenerReservasPorFecha
// ─────────────────────────────────────────────────────────
router.get('/reservas/:fecha', obtenerReservasPorFecha);

// ────────────────────────────────────────────────────────
//  PUT /admin/actualizarEstadoPago
// ─────────────────────────────────────────────────────────
router.put('/reservas/:idReserva/pago', actualizarEstadoPago);
// ────────────────────────────────────────────────────────
//  DELETE /admin/eliminarReserva
// ─────────────────────────────────────────────────────────
router.delete('/reservas/:idReserva', deleteReserva);

/**
 * POST /api/admin/reservas/corporativa/:idReserva
 * Guardar detalles de invitados y menú para reserva corporativa
 */
router.post('/reservas/corporativa/:reservaId', guardarInvitadosCorporativos);


/**
 * GET /api/admin/reservas/corporativa/:idReserva
 * Obtener reserva corporativa completa
 */
router.get('/reservas/corporativa/:reservaId', listaInvitadosCorporativos);

/**
 * PUT /api/admin/reservas/corporativa/:idReserva/pago
 * Actualizar estado de pago de reserva corporativa
 */
router.put('/reservas/corporativa/:idReserva/pago', actualizarEstadoPagoCorporativa);

/**
 * POST /api/pagos/procesar
 * Procesar pago de reserva
 */
//router.post('/pagos/procesar', procesarPago);

export default router;
 