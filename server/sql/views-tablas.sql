
-- =========================================================
-- CREAR VISTA PARA OBTENER RESERVAS CON ESTADO
-- =========================================================

CREATE OR REPLACE VIEW v_reservas_con_estado AS
SELECT 
  r.id,
  r.fecha,
  r.hora,
  r.nombre_cliente,
  r.identificador_fiscal,
  r.telefono,
  r.correo,
  r.numero_personas,
  r.tipo_cliente,
  r.motivo,
  r.metodo_pago,
  r.monto,
  r.id_pago_transaccion,
  r.fecha_creacion,
  r.fecha_actualizacion,
  CASE 
    WHEN r.id_pago_transaccion IS NOT NULL THEN 'CONFIRMADO'
    ELSE 'PENDIENTE'
  END AS estado_pago,
  DATE_FORMAT(r.fecha, '%d/%m/%Y') as fecha_formateada,
  DATE_FORMAT(r.fecha, '%Y-%m-%d') as fecha_iso,
  TIME_FORMAT(r.hora, '%H:%i') as hora_formateada
FROM reservas r;

-- =========================================================
-- CREAR VISTA PARA ESTADÍSTICAS DIARIAS
-- =========================================================

CREATE OR REPLACE VIEW v_reservas_stats_diarias AS
SELECT 
  r.fecha,
  DATE_FORMAT(r.fecha, '%d/%m/%Y') as fecha_formateada,
  COUNT(*) as total_reservas,
  SUM(r.numero_personas) as total_personas,
  COUNT(DISTINCT r.tipo_cliente) as tipos_cliente,
  SUM(CASE WHEN r.id_pago_transaccion IS NOT NULL THEN 1 ELSE 0 END) as confirmadas,
  SUM(CASE WHEN r.id_pago_transaccion IS NULL THEN 1 ELSE 0 END) as pendientes,
  SUM(CASE WHEN r.tipo_cliente = 'corporativa' THEN 1 ELSE 0 END) as corporativas,
  SUM(CASE WHEN r.tipo_cliente = 'personal' THEN 1 ELSE 0 END) as personales,
  SUM(CASE WHEN r.tipo_cliente = 'extranjero' THEN 1 ELSE 0 END) as extranjeros
FROM reservas r
WHERE r.fecha >= DATE(DATE_SUB(NOW(), INTERVAL 30 DAY))
GROUP BY r.fecha, DATE_FORMAT(r.fecha, '%d/%m/%Y')
ORDER BY r.fecha DESC;

-- =========================================================
-- CREAR VISTA PARA RESERVAS PRÓXIMAS (PRÓXIMOS 7 DÍAS)
-- =========================================================

CREATE OR REPLACE VIEW v_reservas_proximas AS
SELECT 
  id,
  fecha,
  hora,
  nombre_cliente,
  identificador_fiscal,
  numero_personas,
  tipo_cliente,
  motivo,
  id_pago_transaccion,
  CASE 
    WHEN id_pago_transaccion IS NOT NULL THEN 'CONFIRMADO'
    ELSE 'PENDIENTE'
  END AS estado_pago
FROM reservas
WHERE fecha BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 7 DAY)
ORDER BY fecha ASC, hora ASC;

-- =========================================================
-- CREAR STORED PROCEDURE PARA CONFIRMAR PAGO
-- =========================================================

DELIMITER //

CREATE PROCEDURE IF NOT EXISTS sp_confirmar_pago(
  IN p_reserva_id INT,
  IN p_metodo_pago VARCHAR(50),
  IN p_id_transaccion VARCHAR(100)
)
BEGIN
  DECLARE EXIT HANDLER FOR SQLEXCEPTION
  BEGIN
    ROLLBACK;
    SELECT 'ERROR' AS resultado, 'No se pudo confirmar el pago' AS mensaje;
  END;

  START TRANSACTION;
  
  UPDATE reservas 
  SET metodo_pago = p_metodo_pago,
      id_pago_transaccion = p_id_transaccion
  WHERE id = p_reserva_id;

  IF ROW_COUNT() = 0 THEN
    ROLLBACK;
    SELECT 'ERROR' AS resultado, 'Reserva no encontrada' AS mensaje;
  ELSE
    COMMIT;
    SELECT 'OK' AS resultado, 'Pago confirmado exitosamente' AS mensaje;
  END IF;
END //

DELIMITER ;

-- =========================================================
-- CREAR STORED PROCEDURE PARA OBTENER RESERVAS CON FILTROS
-- =========================================================

DELIMITER //

CREATE PROCEDURE IF NOT EXISTS sp_obtener_reservas(
  IN p_fecha VARCHAR(10),
  IN p_tipo_cliente VARCHAR(20),
  IN p_estado_pago VARCHAR(20)
)
BEGIN
  SELECT * FROM v_reservas_con_estado
  WHERE 
    (p_fecha IS NULL OR fecha = STR_TO_DATE(p_fecha, '%Y-%m-%d'))
    AND (p_tipo_cliente IS NULL OR tipo_cliente = p_tipo_cliente)
    AND (p_estado_pago IS NULL OR estado_pago = p_estado_pago)
  ORDER BY fecha DESC, hora ASC;
END //

DELIMITER ;

-- =========================================================
-- DATOS DE EJEMPLO (OPCIONAL - descomentar para testing)
-- =========================================================

/*
INSERT INTO reservas (
  tipo_cliente,
  identificador_fiscal,
  nombre_cliente,
  telefono,
  correo,
  numero_personas,
  fecha,
  hora,
  motivo,
  metodo_pago,
  id_pago_transaccion,
  archivo_lista_invitados
) VALUES 
(
  'personal',
  '12345678',
  'Juan Pérez Mendoza',
  '+51987654321',
  'juan@email.com',
  4,
  '2024-04-25',
  '19:30',
  'Cumpleaños',
  'Yape',
  'YPE-2024-04-21-001',
  NULL
),
(
  'corporativa',
  '20123456789',
  'Acme Corporation',
  '+51912345678',
  'eventos@acme.com',
  50,
  '2024-04-26',
  '18:00',
  'Reunión de equipos',
  'Tarjeta',
  'TRX-2024-04-21-002',
  'https://storage.example.com/listas/acme-50-personas.xlsx'
),
(
  'extranjero',
  'EXTRANJERO',
  'Maria González',
  '+34912345678',
  'maria@email.es',
  2,
  '2024-04-27',
  '20:00',
  'Turismo',
  'Tarjeta',
  'TRX-2024-04-21-003',
  NULL
);
*/

-- =========================================================
-- QUERIES ÚTILES PARA ADMINISTRACIÓN
-- =========================================================

-- Consultar todas las reservas (usar view)
-- SELECT * FROM v_reservas_con_estado ORDER BY fecha DESC, hora ASC;

-- Consultar próximas reservas
-- SELECT * FROM v_reservas_proximas;

-- Ver estadísticas por día
-- SELECT * FROM v_reservas_stats_diarias;

-- Contar reservas por estado
-- SELECT estado_pago, COUNT(*) as cantidad FROM v_reservas_con_estado GROUP BY estado_pago;

-- Ingresos por método de pago
-- SELECT metodo_pago, COUNT(*) as transacciones FROM v_reservas_con_estado 
-- WHERE estado_pago = 'CONFIRMADO' GROUP BY metodo_pago;

-- Ocupación total
-- SELECT SUM(numero_personas) as total_personas, COUNT(*) as total_reservas FROM reservas;

-- Confirmar pago (usando procedure)
-- CALL sp_confirmar_pago(1, 'Tarjeta', 'TRX-2024-04-21-NEW');

-- Obtener reservas con filtros (usando procedure)
-- CALL sp_obtener_reservas('2024-04-25', 'personal', NULL);

