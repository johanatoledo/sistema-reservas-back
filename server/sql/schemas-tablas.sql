CREATE DATABASE IF NOT EXISTS restaurante_lime;
USE restaurante_lime;

-- =========================================================
-- CREAR TABLA PRINCIPAL: reservas
-- =========================================================


CREATE TABLE IF NOT EXISTS reservas (
  -- IDENTIFICADORES
  id INT AUTO_INCREMENT PRIMARY KEY 
    COMMENT 'ID único de la reserva',
  
  -- INFORMACIÓN DEL CLIENTE
  tipo_cliente ENUM('personal', 'corporativa', 'extranjero') NOT NULL 
    COMMENT 'Tipo de cliente: personal, corporativa o extranjero',
  
  identificador_fiscal VARCHAR(20) NOT NULL 
    COMMENT 'DNI (8 dígitos), RUC (11 dígitos) o "EXTRANJERO"',
  
  nombre_cliente VARCHAR(150) NOT NULL 
    COMMENT 'Nombre completo del cliente o representante',
  
  telefono VARCHAR(20) NOT NULL 
    COMMENT 'Número de teléfono del cliente',
  
  correo VARCHAR(255) 
    COMMENT 'Email del cliente para confirmación y seguimiento',
  
  -- DETALLES DE LA RESERVA
  numero_personas INT NOT NULL 
    COMMENT 'Cantidad de comensales',
  
  fecha DATE NOT NULL 
    COMMENT 'Fecha de la reserva (YYYY-MM-DD)',
  
  hora TIME NOT NULL 
    COMMENT 'Hora de la reserva (HH:MM)',
  
  motivo VARCHAR(255) DEFAULT 'Reserva estándar'
    COMMENT 'Razón de la reserva (cumpleaños, reunión, etc)',
  
  -- INFORMACIÓN DE PAGO
  metodo_pago ENUM('Yape', 'Tarjeta', 'Transferencia', 'Efectivo', 'Pendiente') 
    DEFAULT 'Pendiente'
    COMMENT 'Método de pago elegido por el cliente',
  
  id_pago_transaccion VARCHAR(100) 
    COMMENT 'ID único de la transacción de pago (comprobante)',
  
  monto DECIMAL(10, 2) DEFAULT 0.00
    COMMENT 'Monto total de la reserva (calculado o ingresado)',
  
  estado_pago ENUM('pendiente', 'confirmada') DEFAULT 'pendiente',
  -- AUDITORÍA Y TIMESTAMPS
  fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP 
    COMMENT 'Cuándo se creó el registro de reserva',
  
  fecha_actualizacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP 
    COMMENT 'Última actualización del registro',
  
  -- RESTRICCIONES Y VALIDACIONES
  CHECK (numero_personas > 0),
  
  -- ÍNDICES PARA BÚSQUEDAS RÁPIDAS
  INDEX idx_fecha (fecha),
  INDEX idx_nombre (nombre_cliente),
  INDEX idx_tipo (tipo_cliente),
  INDEX idx_identificador (identificador_fiscal),
  INDEX idx_estado_pago (id_pago_transaccion),
  INDEX idx_estado (estado_pago),
  INDEX idx_fecha_creacion (fecha_creacion),
  INDEX idx_fecha_hora (fecha, hora)
  
) 
ENGINE=InnoDB 
DEFAULT CHARSET=utf8mb4 
COLLATE=utf8mb4_unicode_ci
COMMENT='Tabla principal de reservas del restaurante Limeñita';

-- ============================================
-- BASE DE DATOS: SISTEMA DE RESERVAS CORPORATIVAS
-- ============================================
-- TABLA 1: Reservas Corporativas (Nueva)Invitados (Nueva - para reservas corporativas)
CREATE TABLE IF NOT EXISTS invitados_reserva (
  id INT AUTO_INCREMENT PRIMARY KEY,
  id_reserva INT NOT NULL,
  nombre_invitado VARCHAR(150) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (id_reserva) REFERENCES reservas(id) ON DELETE CASCADE,
  INDEX idx_id_reserva (id_reserva)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- TABLA 2: Detalles de Platos/Bebidas por Invitado (Nueva)
CREATE TABLE IF NOT EXISTS detalle_menu_invitado (
  id INT AUTO_INCREMENT PRIMARY KEY,
  id_invitado INT NOT NULL,
  nombre_plato VARCHAR(200) NOT NULL,
  precio_plato DECIMAL(10, 2) NOT NULL,
  cantidad INT DEFAULT 1,
  subtotal DECIMAL(10, 2) NOT NULL, -- precio * cantidad
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (id_invitado) REFERENCES invitados_reserva(id) ON DELETE CASCADE,
  INDEX idx_id_invitado (id_invitado)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- TABLA 3: Resumen de Costos por Reserva (Nueva - para auditoría)
CREATE TABLE IF NOT EXISTS resumen_costos_reserva (
  id INT AUTO_INCREMENT PRIMARY KEY,
  id_reserva INT NOT NULL UNIQUE,
  numero_invitados INT NOT NULL,
  costo_por_invitado DECIMAL(10, 2),
  total_platos DECIMAL(10, 2) DEFAULT 0.00,
  total_bebidas DECIMAL(10, 2) DEFAULT 0.00,
  monto_total DECIMAL(10, 2) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (id_reserva) REFERENCES reservas(id) ON DELETE CASCADE,
  INDEX idx_id_reserva (id_reserva)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- TABLA 4: Transacciones de Pago (Nueva - para auditoría de pagos)
CREATE TABLE IF NOT EXISTS transacciones_pago (
  id INT AUTO_INCREMENT PRIMARY KEY,
  id_reserva INT NOT NULL,
  id_transaccion_externa VARCHAR(100),
  metodo_pago VARCHAR(50),
  monto DECIMAL(10, 2) NOT NULL,
  estado ENUM('pendiente', 'procesando', 'completada', 'fallida', 'cancelada') DEFAULT 'pendiente',
  respuesta_pago JSON,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (id_reserva) REFERENCES reservas(id) ON DELETE CASCADE,
  INDEX idx_id_reserva (id_reserva),
  INDEX idx_estado (estado)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
