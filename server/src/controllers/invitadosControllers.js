import pool from "../config/db.js";

export const guardarInvitadosCorporativos = async (req, res) => {
  const connection = await pool.getConnection();
  
  try {
    await connection.beginTransaction();

    const {
      id_reserva_base, // Viene del token decodificado en el form
      invitados,       // Array de objetos de invitados
      monto  // Calculado en el frontend
    } = req.body;

    // ══════════════════════════════════════════════════════════
    // PASO 1: CÁLCULO DE TOTALES (PLATOS VS BEBIDAS)
    // ══════════════════════════════════════════════════════════
    const categoriasBebidas = [
      'Bebidas', 'Infusiones', 'Cocteles Limeños', 'Cocteles Clasicos', 
      'Mocktails (sin alcohol)', 'Calientitos', 'Gins & Tonics (Perfect serve)'
    ];

    let total_platos = 0;
    let total_bebidas = 0;

    invitados.forEach(inv => {
      inv.menuSeleccionado.forEach(item => {
        const subtotal = parseFloat(item.precio) * (parseInt(item.cantidad) || 1);
        if (categoriasBebidas.includes(item.categoria)) {
          total_bebidas += subtotal;
        } else {
          total_platos += subtotal;
        }
      });
    });

    // ══════════════════════════════════════════════════════════
    // PASO 2: INSERTAR RESUMEN DE COSTOS
    // ══════════════════════════════════════════════════════════
    const queryResumen = `
      INSERT INTO resumen_costos_reserva 
      (id_reserva, numero_invitados, total_platos, total_bebidas, monto_total) 
      VALUES (?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE 
      numero_invitados = VALUES(numero_invitados),
      total_platos = VALUES(total_platos),
      total_bebidas = VALUES(total_bebidas),
      monto_total = VALUES(monto_total)
    `;

    await connection.execute(queryResumen, [
      id_reserva_base,
      invitados.length,
      total_platos,
      total_bebidas,
      monto
    ]);

    // ══════════════════════════════════════════════════════════
    // PASO 3: INSERTAR INVITADOS Y DETALLES DE MENÚ
    // ══════════════════════════════════════════════════════════
    // Limpiar los invitados anteriores si la empresa está editando o reintentando
    await connection.execute(`DELETE FROM invitados_reserva WHERE id_reserva = ?`, [id_reserva_base]);

    const queryInvitado = `INSERT INTO invitados_reserva (id_reserva, nombre_invitado) VALUES (?, ?)`;
    const queryMenu = `
      INSERT INTO detalle_menu_invitado 
      (id_invitado, categoria_menu, nombre_plato, precio_plato, cantidad, subtotal) 
      VALUES (?, ?, ?, ?, ?, ?)
    `;

    for (const invitado of invitados) {
      const [resultInvitado] = await connection.execute(queryInvitado, [
        id_reserva_base,
        invitado.nombre
      ]);

      const idInvitadoInsertado = resultInvitado.insertId;

      for (const item of invitado.menuSeleccionado) {
        const precio = parseFloat(item.precio) || 0;
        const cant = parseInt(item.cantidad) || 1;
        const subtotal = precio * cant;
        await connection.execute(queryMenu, [
          idInvitadoInsertado,
          item.categoria,
          item.nombre,
          item.precio,
          item.cantidad,
          subtotal
        ]);
      }
    }

    // Actualizar el monto en la tabla principal de reservas
    await connection.execute(
      "UPDATE reservas SET monto = ? WHERE id = ?",
      [monto, id_reserva_base]
    );

    await connection.commit();
    
    return res.status(200).json({
      success: true,
      message: 'Reserva corporativa completada exitosamente',
      idReserva: id_reserva_base
    });

  } catch (error) {
    await connection.rollback();
    console.error('❌ Error en guardarInvitadosCorporativos:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Error al procesar el detalle corporativo',
      error: error.message
    });
  } finally {
    connection.release();
  }
};



export const listaInvitadosCorporativos= async (req, res) => {
  const { reservaId } = req.params;

  try {
    // 1. Obtener el resumen de costos de la reserva
    const [resumen] = await pool.execute(
      `SELECT * FROM resumen_costos_reserva WHERE id_reserva = ?`,
      [reservaId]
    );

    // 1.5. Obtener el nombre del cliente/empresa para el título del Modal
    const [reservaInfo] = await pool.execute(
      `SELECT nombre_cliente, identificador_fiscal, fecha, hora FROM reservas WHERE id = ?`,
      [reservaId]
    );

    // 2. Obtener invitados y sus respectivos platos/bebidas
    const queryDetalle = `
      SELECT 
        i.id AS invitado_id,
        i.nombre_invitado,
        d.id AS detalle_id,
        d.nombre_plato,
        d.precio_plato,
        d.cantidad,
        d.subtotal,
        d.categoria_menu
      FROM invitados_reserva i
      LEFT JOIN detalle_menu_invitado d ON i.id = d.id_invitado
      WHERE i.id_reserva = ?
      ORDER BY i.id ASC;
    `;

    const [filas] = await pool.execute(queryDetalle, [reservaId]);

    // 3. Transformar los datos: Agrupar platos dentro de cada invitado
    const invitadosMap = filas.reduce((acc, fila) => {
      const { invitado_id, nombre_invitado, ...detalle } = fila;

      if (!acc[invitado_id]) {
        acc[invitado_id] = {
          id: invitado_id,
          nombre_invitado: nombre_invitado,
          menuItems: []
        };
      }

      // Si el invitado tiene platos (evita nulos por el LEFT JOIN)
      if (detalle.detalle_id) {
        acc[invitado_id].menuItems.push({
          id: detalle.detalle_id,
          nombre: detalle.nombre_plato,
          precio: detalle.precio_plato,
          cantidad: detalle.cantidad,
          subtotal: detalle.subtotal,
          categoria: detalle.categoria_menu
        });
      }

      return acc;
    }, {});

    // Convertir el objeto mapa en un array
    const listaInvitados = Object.values(invitadosMap);

    return res.status(200).json({
      success: true,
      nombre_cliente: reservaInfo.length > 0 ? reservaInfo[0].nombre_cliente : 'Empresa',
      ruc: reservaInfo.length > 0 ? reservaInfo[0].identificador_fiscal : '',
      fecha: reservaInfo.length > 0 ? reservaInfo[0].fecha : '',
      hora: reservaInfo.length > 0 ? reservaInfo[0].hora : '',
      resumenCostos: resumen[0] || null,
      invitados: listaInvitados
    });

  } catch (error) {
    console.error("❌ Error al obtener invitados:", error.message);
    return res.status(500).json({
      success: false,
      message: "Error al obtener el detalle de la reserva corporativa",
      error: error.message
    });
  }
};

// ══════════════════════════════════════════════════════════
// ACTUALIZAR ESTADO DE PAGO (CORPORATIVA)
// ══════════════════════════════════════════════════════════
export const actualizarEstadoPagoCorporativa = async (req, res) => {
  const { idReserva } = req.params;
  const { id_pago_transaccion, metodo_pago } = req.body;

  if (!id_pago_transaccion || !metodo_pago) {
    return res.status(400).json({ 
      success: false, 
      message: "El ID de transacción y el método de pago son obligatorios" 
    });
  }

  try {
    const [result] = await pool.execute(
      `UPDATE reservas SET id_pago_transaccion = ?, metodo_pago = ? WHERE id = ?`,
      [id_pago_transaccion, metodo_pago, idReserva]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: "Reserva no encontrada" });
    }

    return res.status(200).json({ success: true, message: "Pago registrado exitosamente" });
  } catch (error) {
    console.error("❌ Error al actualizar pago:", error.message);
    return res.status(500).json({ success: false, message: "Error al procesar el pago" });
  }
};