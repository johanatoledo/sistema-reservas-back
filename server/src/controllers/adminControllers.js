import pool from "../config/db.js";

/**
 * GuardarReserva
 * ===============
 * Guarda una nueva reserva en la base de datos con validación exhaustiva.
 * @param {Object} datos - Objeto con los datos de la reserva
 * @returns {Object} { insertId, affectedRows, success, message }
 */
export const GuardarReserva = async (datos) => {
  try {
    //  1.VALIDAR CAMPOS REQUERIDOS
    const camposRequeridos = [
      'tipo_cliente',
      'nombre_cliente',
      'telefono',
      'numero_personas',
      'fecha',
      'hora'
    ];
    
    //2.Validar faltantes
    const faltantes = camposRequeridos.filter(campo => !datos[campo]);
    if (faltantes.length > 0) {
      console.error('❌ Campos requeridos faltantes:', faltantes);
      return {
        success: false,
        message: `Campos requeridos faltantes: ${faltantes.join(', ')}`,
        error: faltantes
      };
    }
    
    //3.Gestion de identificador fiscal
    let idFiscal = datos.identificador_fiscal;

     //4. Solo pedimos identificador_fiscal si NO es extranjero
    if (datos.tipo_cliente !== 'extranjero') {
      camposRequeridos.push('identificador_fiscal');
       }

        
    // 5.Si es extranjero y no envió ID, generamos uno (Ej: EXT-1713723000)
    if (datos.tipo_cliente === 'extranjero' && !idFiscal) {
      idFiscal = `EXT-${Date.now().toString().slice(-8)}`; 
    }
    
    
    // 6: SANITIZAR Y VALIDAR TIPOS
    const reserva = {
      tipo_cliente: String(datos.tipo_cliente).toLowerCase().trim(),
      identificador_fiscal: String(idFiscal).trim().toUpperCase(),
      nombre_cliente: String(datos.nombre_cliente).trim(),
      telefono: String(datos.telefono).trim(),
      correo: datos.correo ? String(datos.correo).trim() : null,
      numero_personas: parseInt(datos.numero_personas, 10),
      fecha: String(datos.fecha).trim(), // Formato: YYYY-MM-DD
      hora: String(datos.hora).trim(),   // Formato: HH:MM
      motivo: datos.motivo ? String(datos.motivo).trim() : 'Reserva estándar',
      metodo_pago: datos.metodo_pago ? String(datos.metodo_pago).trim() : null,
      id_pago_transaccion: datos.id_pago_transaccion ? String(datos.id_pago_transaccion).trim() : null,
      monto: datos.monto ? parseFloat(datos.monto) : null,
    };

    // 7: VALIDAR VALORES
    if (!/^\d{4}-\d{2}-\d{2}$/.test(reserva.fecha)) {
      console.error('❌ Formato de fecha inválido:', reserva.fecha);
      return {
        success: false,
        message: 'Formato de fecha inválido. Use YYYY-MM-DD'
      };
    }

    if (!/^\d{2}:\d{2}$/.test(reserva.hora)) {
      console.error('❌ Formato de hora inválido:', reserva.hora);
      return {
        success: false,
        message: 'Formato de hora inválido. Use HH:MM'
      };
    }

    if (isNaN(reserva.numero_personas) || reserva.numero_personas < 1) {
      console.error('❌ Número de personas inválido:', reserva.numero_personas);
      return {
        success: false,
        message: 'El número de personas debe ser mayor a 0'
      };
    }

    const tiposValidos = ['personal', 'corporativa', 'extranjero'];
    if (!tiposValidos.includes(reserva.tipo_cliente)) {
      console.error('❌ Tipo de cliente inválido:', reserva.tipo_cliente);
      return {
        success: false,
        message: `Tipo de cliente inválido. Debe ser: ${tiposValidos.join(', ')}`
      };
    }

    // ✅ 8: EJECUTAR QUERY
    const query = `
      INSERT INTO reservas 
      (tipo_cliente, identificador_fiscal, nombre_cliente, telefono, correo, numero_personas, fecha, hora, motivo, metodo_pago, id_pago_transaccion,monto) 
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
      reserva.monto
    ];

    console.log('📝 Insertando reserva con valores:', {
      ...reserva,
      id_pago_transaccion: reserva.id_pago_transaccion ? '***OCULTO***' : null
    });

    const [result] = await pool.execute(query, values);

    // RESPUESTA Y GENERACIÓN DE LINK SI ES CORPORATIVA
    if (result.insertId) {
      const id_reserva = result.insertId;
      let linkFormulario = null;

      if (reserva.tipo_cliente === 'corporativa') {
        const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
        linkFormulario = `${frontendUrl}/formulario-invitados/${id_reserva}`;
        console.log('✅ Link corporativo generado:', linkFormulario);
      }

      console.log('✅ Reserva guardada exitosamente. ID:', id_reserva);
      return {
        success: true,
        insertId: id_reserva,
        affectedRows: result.affectedRows,
        message: 'Reserva guardada correctamente',
        linkFormulario: linkFormulario
      };
    } else {
      console.error('❌ No se generó ID de inserción');
      return {
        success: false,
        message: 'Error al guardar la reserva en la base de datos'
      };
    }
  } catch (error) {
    console.error('❌ Error en GuardarReserva:', error.message);
    console.error('Datos recibidos:', datos);
    
    // Diferenciar errores de base de datos
    let mensaje = 'Error al guardar la reserva';
    
    if (error.code === 'ER_DUP_ENTRY') {
      mensaje = 'Esta reserva ya existe en el sistema';
    } else if (error.code === 'ER_BAD_NULL_ERROR') {
      mensaje = 'Falta un campo requerido en la base de datos';
    } else if (error.code === 'ER_DATA_OUT_OF_RANGE') {
      mensaje = 'Alguno de los valores está fuera de rango';
    }

    return {
      success: false,
      message: mensaje,
      error: error.message
    };
  }
};

/**
 * obtenerReservas
 * ================
 * Obtiene todas las reservas ordenadas por fecha y hora.
 * Con validación completa de respuesta.
 */
export const obtenerReservas = async (req, res) => {
  try {
    const [rows] = await pool.execute(
      'SELECT * FROM reservas ORDER BY fecha DESC, hora ASC'
    );

    // ✅ VALIDAR QUE rows SEA ARRAY
    if (!Array.isArray(rows)) {
      console.error('❌ Respuesta de BD no es array:', rows);
      return res.status(500).json({ 
        error: "Error inesperado al obtener reservas",
        success: false 
      });
    }

    // ✅ VALIDAR QUE NO HAYA VALORES NULL EN CAMPOS CRÍTICOS
    const reservasValidas = rows.map(res => ({
      ...res,
      nombre_cliente: res.nombre_cliente || 'Sin nombre',
      identificador_fiscal: res.identificador_fiscal || 'N/A',
      telefono: res.telefono || 'N/A',
      motivo: res.motivo || 'Reserva estándar',
      metodo_pago: res.metodo_pago || 'Pendiente',
      correo: res.correo || 'N/A',
      monto: res.monto || 0,
      numero_personas: res.numero_personas || 0,
      // Mantener null en transacción si no existe
      id_pago_transaccion: res.id_pago_transaccion
    }));

    console.log(`✅ ${reservasValidas.length} reservas obtenidas`);
    
    return res.status(200).json(reservasValidas);

  } catch (error) {
    console.error('❌ Error en obtenerReservas:', error.message);
    return res.status(500).json({ 
      error: "Error al obtener la lista de reservas",
      success: false,
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};
export const obtenerDetalleCorporativoCompleto = async (req, res) => {
  try {
    const { idReserva } = req.params;

    // 1. Obtener la Reserva y su Resumen de Costos (Tabla 3)
    // Usamos los nombres de columnas de tu schema: total_platos, total_bebidas, monto_total
    const [reservaRows] = await pool.execute(`
      SELECT r.*, rc.total_platos, rc.total_bebidas, rc.monto_total as monto_calculado
      FROM reservas r
      LEFT JOIN resumen_costos_reserva rc ON r.id = rc.id_reserva
      WHERE r.id = ?
    `, [idReserva]);

    if (reservaRows.length === 0) {
      return res.status(404).json({ message: "Reserva no encontrada" });
    }

    // 2. Obtener Invitados (Tabla 1) y Detalles (Tabla 2)
    // Nombres exactos: categoria_menu, nombre_plato_bebida, precio_plato_bebida
    const [invitadosRows] = await pool.execute(`
      SELECT 
        ir.id as invitado_id,
        ir.nombre_invitado,
        dmi.categoria_menu,
        dmi.nombre_plato_bebida,
        dmi.precio_plato_bebida,
        dmi.cantidad
      FROM invitados_reserva ir
      LEFT JOIN detalle_menu_invitado dmi ON ir.id = dmi.id_invitado
      WHERE ir.id_reserva = ?
    `, [idReserva]);

    // 3. Mapeo para el Frontend (Agrupación lógica)
    const invitadosMap = {};
    invitadosRows.forEach(row => {
      if (!invitadosMap[row.invitado_id]) {
        invitadosMap[row.invitado_id] = {
          id: row.invitado_id,
          nombre_invitado: row.nombre_invitado,
          menuItems: []
        };
      }
      
      // Si el invitado tiene platos (evita nulos por el LEFT JOIN)
      if (row.nombre_plato_bebida) {
        invitadosMap[row.invitado_id].menuItems.push({
          categoria: row.categoria_menu,
          nombre: row.nombre_plato_bebida,
          precio: row.precio_plato_bebida,
          cantidad: row.cantidad,
          subtotal: row.precio_plato_bebida * row.cantidad
        });
      }
    });

    // 4. Respuesta Estructurada
    return res.status(200).json({
      ...reservaRows[0],
      invitados: Object.values(invitadosMap),
      resumenCostos: {
        total_platos: reservaRows[0].total_platos || 0,
        total_bebidas: reservaRows[0].total_bebidas || 0,
        monto_total: reservaRows[0].monto_calculado || 0
      }
    });

  } catch (error) {
    console.error("❌ Error en obtenerDetalleCorporativoCompleto:", error.message);
    return res.status(500).json({ error: "Error al recuperar datos corporativos" });
  }
};

/**
 * obtenerReservasPorFecha
 * =======================
 * Obtiene las reservas para una fecha específica.
 */
export const obtenerReservasPorFecha = async (req, res) => {
  try {
    const { fecha } = req.params;

    // Validar formato de fecha
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
      return res.status(400).json({ 
        error: "Formato de fecha inválido. Use YYYY-MM-DD",
        success: false
      });
    }

    const [rows] = await pool.execute(
      'SELECT * FROM reservas WHERE fecha = ? ORDER BY hora ASC',
      [fecha]
    );

    if (!Array.isArray(rows)) {
      return res.status(500).json({ 
        error: "Error al procesar las reservas",
        success: false 
      });
    }

    console.log(`✅ ${rows.length} reservas encontradas para ${fecha}`);
    
    return res.status(200).json(rows);

  } catch (error) {
    console.error('❌ Error en obtenerReservasPorFecha:', error.message);
    return res.status(500).json({ 
      error: "Error al obtener reservas por fecha",
      success: false
    });
  }
};

/**
 * actualizarEstadoPago
 * ====================
 * Actualiza el estado de pago de una reserva.
 */
export const actualizarEstadoPago = async (req, res) => {
  try {
    const { idReserva } = req.params;
    const { metodo_pago, id_pago_transaccion } = req.body;

    if (!idReserva || !metodo_pago || !id_pago_transaccion) {
      return res.status(400).json({ 
        error: "Faltan parámetros requeridos",
        success: false
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
      idReserva
    ]);

    if (result.affectedRows === 0) {
      return res.status(404).json({ 
        error: "Reserva no encontrada",
        success: false
      });
    }

    console.log(`✅ Reserva ${idReserva} actualizada`);

    return res.status(200).json({
      success: true,
      message: "Pago confirmado correctamente"
    });

  } catch (error) {
    console.error('❌ Error en actualizarEstadoPago:', error.message);
    return res.status(500).json({ 
      error: "Error al actualizar el estado de pago",
      success: false
    });
  }
};

/**
 * deleteReserva
 * ==============
 * Elimina una reserva (soft delete recomendado para auditoría).
 */
export const deleteReserva = async (req, res) => {
  try {
    const { idReserva } = req.params;

    if (!idReserva) {
      return res.status(400).json({ 
        error: "ID de reserva requerido",
        success: false
      });
    }

    const query = 'DELETE FROM reservas WHERE id = ?';
    const [result] = await pool.execute(query, [idReserva]);

    if (result.affectedRows === 0) {
      return res.status(404).json({ 
        error: "Reserva no encontrada",
        success: false
      });
    }

    console.log(`✅ Reserva ${idReserva} eliminada`);

    return res.status(200).json({
      success: true,
      message: "Reserva eliminada correctamente"
    });

  } catch (error) {
    console.error('❌ Error en deleteReserva:', error.message);
    return res.status(500).json({ 
      error: "Error al eliminar la reserva",
      success: false
    });
  }
};