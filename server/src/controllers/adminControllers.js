
import pool from "../config/db.js";

/**
 * Guarda una reserva en MySQL.
 */
export const GuardarReserva = async (datos) => {
  try {
    if (!datos || typeof datos !== "object") {
      return {
        success: false,
        message: "Los datos de la reserva no son válidos.",
      };
    }

    const camposRequeridos = [
      "tipo_cliente",
      "nombre_cliente",
      "telefono",
      "numero_personas",
      "fecha",
      "hora",
    ];

    const faltantes = camposRequeridos.filter((campo) => {
      const valor = datos[campo];
      return valor === undefined || valor === null || String(valor).trim() === "";
    });

    if (faltantes.length > 0) {
      return {
        success: false,
        message: `Campos requeridos faltantes: ${faltantes.join(", ")}`,
        error: faltantes,
      };
    }

    const reserva = {
      tipo_cliente: String(datos.tipo_cliente).toLowerCase().trim(),
      identificador_fiscal: datos.identificador_fiscal
        ? String(datos.identificador_fiscal).trim().toUpperCase()
        : null,
      nombre_cliente: String(datos.nombre_cliente).trim(),
      telefono: String(datos.telefono).trim(),
      correo: datos.correo ? String(datos.correo).trim() : null,
      numero_personas: Number(datos.numero_personas),
      fecha: String(datos.fecha).trim(),
      hora: String(datos.hora).trim(),
      motivo: datos.motivo ? String(datos.motivo).trim() : "Reserva estándar",
      metodo_pago: datos.metodo_pago ? String(datos.metodo_pago).trim() : null,
      id_pago_transaccion: datos.id_pago_transaccion ? String(datos.id_pago_transaccion).trim() : null,
      monto: datos.monto !== undefined && datos.monto !== null && datos.monto !== "" ? Number(datos.monto) : null,
    };

    const tiposValidos = ["personal", "corporativa", "extranjero"];

    if (!tiposValidos.includes(reserva.tipo_cliente)) {
      return {
        success: false,
        message: `Tipo de cliente inválido. Debe ser: ${tiposValidos.join(", ")}`,
      };
    }

    if (!Number.isInteger(reserva.numero_personas) ||
        reserva.numero_personas < 1) {
      return {
        success: false,
        message: "El número de personas debe ser un entero mayor a cero.",
      };
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(reserva.fecha)) {
      return {
        success: false,
        message: "Formato de fecha inválido. Use YYYY-MM-DD.",
      };
    }

    const [anio, mes, dia] = reserva.fecha.split("-").map(Number);
    const fechaUTC = new Date(Date.UTC(anio, mes - 1, dia));

    if ( fechaUTC.getUTCFullYear() !== anio || fechaUTC.getUTCMonth() !== mes - 1 || fechaUTC.getUTCDate() !== dia ) {
      return {
        success: false,
        message: "La fecha indicada no existe.",
      };
    }

    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(reserva.hora)) {
      return {
        success: false,
        message: "Formato de hora inválido. Use HH:MM.",
      };
    }

    if (reserva.monto !== null &&
        (!Number.isFinite(reserva.monto) || reserva.monto < 0)) {
      return {
        success: false,
        message: "El monto indicado no es válido.",
      };
    }

    const metodosValidos = ["Yape", "Tarjeta", "Transferencia"];

    if (reserva.metodo_pago &&
        !metodosValidos.includes(reserva.metodo_pago)) {
      return {
        success: false,
        message: "Método de pago no válido.",
      };
    }

    const montoAdelanto = Number(datos.monto ?? 0);
 
     if (!Number.isFinite(montoAdelanto) || montoAdelanto < 0) {
       return {
        success: false,
        message: "El monto del adelanto no es válido.",
      };
      }

      if (montoAdelanto > 0) {
        if (!datos.metodo_pago || !datos.id_pago_transaccion?.trim()) {
          return {
             success: false,
             message: "Para registrar un adelanto debe indicar el método de pago y el número de operación.",
         };
       }
      }

    const query = `
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
        monto
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const values = [
      reserva.tipo_cliente,
      reserva.identificador_fiscal,
      reserva.nombre_cliente,
      reserva.telefono,
      reserva.correo,
      reserva.numero_personas,
      reserva.fecha,
      reserva.hora,
      reserva.motivo,
      reserva.metodo_pago,
      reserva.id_pago_transaccion,
      reserva.monto,
    ];

    const [result] = await pool.execute(query, values);

    if (!result.insertId) {
      return {
        success: false,
        message: "No se pudo registrar la reserva.",
      };
    }

    const idReserva = result.insertId;
    let linkFormulario = null;

    if (reserva.tipo_cliente === "corporativa") {
      const frontendUrl =
        process.env.FRONTEND_URL || "http://localhost:5173";

      linkFormulario =
        `${frontendUrl}/formulario-invitados/${idReserva}`;
    }

    console.log("Reserva registrada correctamente:", idReserva);

    return {
      success: true,
      insertId: idReserva,
      affectedRows: result.affectedRows,
      message: "Reserva guardada correctamente.",
      linkFormulario,
    };
  } catch (error) {
    console.error("Error en GuardarReserva:", error.message);

    let mensaje = "Error al guardar la reserva.";

    if (error.code === "ER_DUP_ENTRY") {
      mensaje = "Esta reserva ya existe en el sistema.";
    } else if (error.code === "ER_BAD_NULL_ERROR") {
      mensaje = "Falta un campo requerido en la base de datos.";
    } else if (error.code === "ER_DATA_OUT_OF_RANGE") {
      mensaje = "Alguno de los valores está fuera de rango.";
    }

    return {
      success: false,
      message: mensaje,
      error:
        process.env.NODE_ENV === "development"
          ? error.message
          : undefined,
    };
  }
};

/**
 * Obtiene todas las reservas.
 */
export const obtenerReservas = async (req, res) => {
  try {
    const [rows] = await pool.execute(
      "SELECT * FROM reservas ORDER BY fecha DESC, hora ASC"
    );

    if (!Array.isArray(rows)) {
      return res.status(500).json({
        error: "Error inesperado al obtener reservas.",
        success: false,
      });
    }

    const reservasValidas = rows.map((reserva) => ({
      ...reserva,
      nombre_cliente: reserva.nombre_cliente || "Sin nombre",
      identificador_fiscal: reserva.identificador_fiscal || "N/A",
      telefono: reserva.telefono || "N/A",
      motivo: reserva.motivo || "Reserva estándar",
      metodo_pago: reserva.metodo_pago || "Pendiente",
      correo: reserva.correo || "N/A",
      monto: reserva.monto ?? 0,
      numero_personas: reserva.numero_personas ?? 0,
      id_pago_transaccion: reserva.id_pago_transaccion,
    }));

    console.log(`${reservasValidas.length} reservas obtenidas.`);

    return res.status(200).json(reservasValidas);
  } catch (error) {
    console.error("Error en obtenerReservas:", error.message);

    return res.status(500).json({
      error: "Error al obtener la lista de reservas.",
      success: false,
      details:
        process.env.NODE_ENV === "development"
          ? error.message
          : undefined,
    });
  }
};

/**
 * Obtiene el detalle completo de una reserva corporativa.
 */
export const obtenerDetalleCorporativoCompleto = async (req, res) => {
  try {
    const { idReserva } = req.params;

    const [reservaRows] = await pool.execute(
      `
      SELECT
        r.*,
        rc.total_platos,
        rc.total_bebidas,
        rc.monto_total AS monto_calculado
      FROM reservas r
      LEFT JOIN resumen_costos_reserva rc
        ON r.id = rc.id_reserva
      WHERE r.id = ?
      `,
      [idReserva]
    );

    if (reservaRows.length === 0) {
      return res.status(404).json({
        message: "Reserva no encontrada.",
      });
    }

    const [invitadosRows] = await pool.execute(
      `
      SELECT
        ir.id AS invitado_id,
        ir.nombre_invitado,
        dmi.categoria_menu,
        dmi.nombre_plato_bebida,
        dmi.precio_plato_bebida,
        dmi.cantidad
      FROM invitados_reserva ir
      LEFT JOIN detalle_menu_invitado dmi
        ON ir.id = dmi.id_invitado
      WHERE ir.id_reserva = ?
      `,
      [idReserva]
    );

    const invitadosMap = {};

    invitadosRows.forEach((row) => {
      if (!invitadosMap[row.invitado_id]) {
        invitadosMap[row.invitado_id] = {
          id: row.invitado_id,
          nombre_invitado: row.nombre_invitado,
          menuItems: [],
        };
      }

      if (row.nombre_plato_bebida) {
        invitadosMap[row.invitado_id].menuItems.push({
          categoria: row.categoria_menu,
          nombre: row.nombre_plato_bebida,
          precio: row.precio_plato_bebida,
          cantidad: row.cantidad,
          subtotal:
            row.precio_plato_bebida * row.cantidad,
        });
      }
    });

    const reserva = reservaRows[0];

    return res.status(200).json({
      ...reserva,
      invitados: Object.values(invitadosMap),
      resumenCostos: {
        total_platos: reserva.total_platos || 0,
        total_bebidas: reserva.total_bebidas || 0,
        monto_total: reserva.monto_calculado || 0,
      },
    });
  } catch (error) {
    console.error(
      "Error en obtenerDetalleCorporativoCompleto:",
      error.message
    );

    return res.status(500).json({
      error: "Error al recuperar datos corporativos.",
    });
  }
};

/**
 * Obtiene reservas por fecha.
 */
export const obtenerReservasPorFecha = async (req, res) => {
  try {
    const { fecha } = req.params;

    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
      return res.status(400).json({
        error: "Formato de fecha inválido. Use YYYY-MM-DD.",
        success: false,
      });
    }

    const [rows] = await pool.execute(
      "SELECT * FROM reservas WHERE fecha = ? ORDER BY hora ASC",
      [fecha]
    );

    if (!Array.isArray(rows)) {
      return res.status(500).json({
        error: "Error al procesar las reservas.",
        success: false,
      });
    }

    console.log(`${rows.length} reservas encontradas para ${fecha}.`);

    return res.status(200).json(rows);
  } catch (error) {
    console.error(
      "Error en obtenerReservasPorFecha:",
      error.message
    );

    return res.status(500).json({
      error: "Error al obtener reservas por fecha.",
      success: false,
    });
  }
};

/**
 * Actualiza los datos de pago de una reserva.
 * Conserva el comportamiento del controlador original.
 */
export const actualizarEstadoPago = async (req, res) => {
  try {
    const { idReserva } = req.params;
    const { metodo_pago, id_pago_transaccion } = req.body || {};

    if (!idReserva || !metodo_pago || !id_pago_transaccion) {
      return res.status(400).json({
        error: "Faltan parámetros requeridos.",
        success: false,
      });
    }

    const query = `
      UPDATE reservas
      SET metodo_pago = ?, id_pago_transaccion = ?
      WHERE id = ?
    `;

    const [result] = await pool.execute(query, [
      metodo_pago,
      id_pago_transaccion,
      idReserva,
    ]);

    if (result.affectedRows === 0) {
      return res.status(404).json({
        error: "Reserva no encontrada.",
        success: false,
      });
    }

    console.log(`Reserva ${idReserva} actualizada.`);

    return res.status(200).json({
      success: true,
      message: "Datos de pago actualizados correctamente.",
    });
  } catch (error) {
    console.error(
      "Error en actualizarEstadoPago:",
      error.message
    );

    return res.status(500).json({
      error: "Error al actualizar los datos de pago.",
      success: false,
    });
  }
};

/**
 * Elimina una reserva.
 * Conserva el DELETE original.
 */
export const deleteReserva = async (req, res) => {
  try {
    const { idReserva } = req.params;

    if (!idReserva) {
      return res.status(400).json({
        error: "ID de reserva requerido.",
        success: false,
      });
    }

    const query = "DELETE FROM reservas WHERE id = ?";

    const [result] = await pool.execute(query, [idReserva]);

    if (result.affectedRows === 0) {
      return res.status(404).json({
        error: "Reserva no encontrada.",
        success: false,
      });
    }

    console.log(`Reserva ${idReserva} eliminada.`);

    return res.status(200).json({
      success: true,
      message: "Reserva eliminada correctamente.",
    });
  } catch (error) {
    console.error("Error en deleteReserva:", error.message);

    return res.status(500).json({
      error: "Error al eliminar la reserva.",
      success: false,
    });
  }
};
