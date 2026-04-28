// server/src/controllers/chatControllers.js - VERSIÓN CORREGIDA
import OpenAI from 'openai';
import { SYSTEM_PROMPT } from '../config/prompts.js';
import { consultarRuc, consultarDni } from '../services/apisPeru.js';
import { GuardarReserva } from '../controllers/adminControllers.js';
import dotenv from 'dotenv';
dotenv.config();

const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// 🛠️ GRUPO A: Siempre activas (Guardar y Transacción)
const toolsComunes = [
  {
    type: "function",
    function: {
        name: "confirmar_y_guardar_reserva",
        description: "Registra la reserva en la base de datos dependiendo si es personal, corporativa o extranjero despues de recolectar todos los datos.",
        parameters: {
            type: "object",
            properties: {
                tipo_cliente: { type: "string", enum: ["personal", "corporativa", "extranjero"] },
                identificador_fiscal: { type: "string", description: "DNI, RUC o EXTRANJERO" },
                nombre_cliente: { type: "string" },
                telefono: { type: "string" },
                correo: { type: "string" },
                numero_personas: { type: "integer" },
                fecha: { type: "string", description: "Formato YYYY-MM-DD" },
                hora: { type: "string", description: "Formato HH:MM" },
                motivo: { type: "string" },
                metodo_pago: { type: "string", enum: ["Yape", "Tarjeta", "Transferencia"], description: "Solo si el cliente desea hacer un adelanto, de lo contrario puede quedar vacío o nulo.Pero si el cliente realiza el pago asegurate q indique por que medio lo hizo" },
                monto: {  type: "number", description: "Monto del adelanto o pago realizado. Es obligatorio si existe un id_pago_transaccion, sin importar si el cliente es personal, corporativo o extranjero." },
                id_pago_transaccion: { type: "string", description: "ID de la transacción de pago, solo si el cliente desea hacer un adelanto y solo valido para reservas personales" }, 
            },
            required: ["tipo_cliente", "identificador_fiscal", "nombre_cliente", "telefono", "numero_personas", "fecha", "hora"]
        }
    }
},
  {
    type: "function",
    function: {
      name: "registrar_transaccion",
      description: "Guarda el ID de la transacción, el monto y método de pago.",
      parameters: {
        type: "object",
        properties: {
          metodo: { type: "string", enum: ["Yape", "Tarjeta", "Transferencia"] },
          id_transaccion: { type: "string" },
          monto: { type: "number", description: "El monto del pago realizado" }
        },
        required: ["metodo", "id_transaccion", "monto"]
      }
    }
  }
];

// 🛠️ GRUPO B: Solo Personal/DNI
const toolDni = {
    type: "function",
    function: {
        name: "obtener_datos_dni",
        description: "Busca los nombres y apellidos de un comensal usando su número de DNI",
        parameters: {
            type: "object",
            properties: {
                dni: { type: "string", description: "El número de DNI de 8 dígitos" }
            },
            required: ["dni"]
        }
    }
};

// 🛠️ GRUPO C: Solo Corporativa (RUC + Enlace)
const toolsCorporativas = [
  {
    type: "function",
    function: {
        name: "obtener_datos_ruc",
        description: "Busca los datos de una empresa usando su número de RUC",
        parameters: {
            type: "object",
            properties: {
                ruc: { type: "string", description: "El número de RUC de 11 dígitos" }
            },
            required: ["ruc"]
        }
    }
},
  {
    type: "function",
    function: {
      name: "generar_enlace_formulario_corporativo",
      description: "Genera el link para la lista de invitados. Solo debe llamarse DESPUÉS de guardar exitosamente la reserva.",
      parameters: {
        type: "object",
        properties: {
          id_reserva_base: { type: "number", description: "El ID numérico (reservaId) retornado por confirmar_y_guardar_reserva" },
          ruc: { type: "string" },
          nombre: { type: "string" },
          fecha: { type: "string" },
          hora: { type: "string" },
          motivo: { type: "string" }
        },
        required: ["id_reserva_base", "ruc", "nombre", "fecha", "hora", "motivo"]
      }
    }
  }
];
// ✅ FUNCIÓN AUXILIAR PARA VALIDAR MENSAJES
const sanitizeMessages = (messages) => {
  return messages.map(msg => ({
    role: msg.role,
    content: (msg.content && String(msg.content).trim()) || "Sin contenido disponible",
    ...(msg.tool_call_id && { tool_call_id: msg.tool_call_id }),
    ...(msg.name && { name: msg.name })
  })).filter(msg => {
    if (!msg.role || !['user', 'assistant', 'tool', 'system'].includes(msg.role)) {
      console.warn('⚠️ Mensaje inválido descartado:', msg);
      return false;
    }
    return true;
  });
};
 

// ✅ CONTROLLER PRINCIPAL DEL CHAT
export const chatController = async (req, res) => {
  const { messages } = req.body;

  // 1. Obtener el historial completo (solo mensajes del usuario para mayor precisión)
  const historialUsuario = messages
    .filter(m => m.role === 'user')
    .map(m => m.content || '')
    .join(' ')
    .toLowerCase();

  const ultimoMsjUsuario = [...messages].reverse().find(m => m.role === 'user');

  console.log('📨 Nuevo mensaje recibido:', ultimoMsjUsuario ? `${ultimoMsjUsuario.content.substring(0, 50)}...` : 'No se encontró mensaje de usuario');
  
  // 2. Detección basada en TODO el historial, no solo el último mensaje
  let clienteFinal = 'personal'; // Valor por defecto

  if (historialUsuario.includes('ruc') || historialUsuario.includes('empresa') || historialUsuario.includes('corporativa')) {
    clienteFinal = 'corporativa';
  } else if (historialUsuario.includes('extranjero') || historialUsuario.includes('no peruano')) {
    clienteFinal = 'extranjero';
  } else if (historialUsuario.includes('dni') || historialUsuario.includes('personal') || historialUsuario.includes('familiar')) {
    clienteFinal = 'personal';
  }

  // 3. Selección de Herramientas (Ahora clienteFinal es persistente)
  let herramientasActivas = [...toolsComunes];

  if (clienteFinal === 'corporativa') {
    herramientasActivas = [...toolsComunes, ...toolsCorporativas];
    
  } else if (clienteFinal === 'personal') {
    herramientasActivas = [...toolsComunes, toolDni];
  } else {
    herramientasActivas = [...toolsComunes];
  }

  
  // 4. Inyectar el contexto reforzado (BLOQUE FUSIONADO)
  const mainSystemPrompt = `${SYSTEM_PROMPT} 

  REGLAS DE EJECUCIÓN INMEDIATA:
  1. Si detectas un número de 11 dígitos y el contexto es CORPORATIVO, USA 'obtener_datos_ruc' inmediatamente.
  2. Si detectas un número de 8 dígitos y el contexto es PERSONAL, USA 'obtener_datos_dni' inmediatamente.
  3. No inventes que validaste datos si no has llamado a la función correspondiente.
  4.NO asumas que la reserva es corporativa si el cliente te ha dicho que es personal.
  5.Si el cliente menciona que desea hacer un adelanto asegurate de tener el MONTO del adelanto y de llamar a 'registrar_transaccion' inmediatamente.
  

  REGLAS DE CIERRE CORPORATIVO:
  4. Si la reserva es CORPORATIVA y ya tienes todos los datos (RUC, Nombre, Teléfono, Correo, Fecha, Hora, Personas, Motivo), DEBES LLAMAR PRIMERO a 'confirmar_y_guardar_reserva' y ESPERAR su respuesta.
  5. SOLO DESPUÉS de recibir el 'reservaId' confirmando que se guardó exitosamente, llama a 'generar_enlace_formulario_corporativo' usando ese ID numérico exacto. NUNCA llames a ambas herramientas al mismo tiempo.
  6. IMPORTANTE: No anuncies "voy a generar el enlace"; simplemente ejecuta la función una vez guardada la reserva. Tu respuesta final DEBE mostrar EXACTAMENTE el valor del  'enlace o link formulario'  exacto devuelta por la función 'generar_enlace_formulario_corporativo', sin inventar, modificar ni acortar la URL.
  6. IMPORTANTE: Tu respuesta final DEBE mostrar EXACTAMENTE el enlace que te devuelve la función 'generar_enlace_formulario_corporativo'. NO inventes, modifiques ni acortes la URL (está prohibido usar dominios como limeñita.com, debes usar la URL exacta provista).
  7. Si te falta algún dato (como el teléfono), pídelo amablemente. NO ejecutes la función de guardado ni del enlace si faltan campos.`;
  // 5. Historial de conversación
  let conversationHistory = [
    { role: 'system', content: mainSystemPrompt },
    ...sanitizeMessages(messages)
  ];

  console.log(`--- ESTADO DEL CHAT ---`);
  console.log(`📨 Cliente Detectado: ${clienteFinal}`);
  console.log(`🔧 Herramientas Cargadas:`, herramientasActivas.map(t => t.function.name).join(', '));

 
 
  // Validación inicial
  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ 
      error: 'El campo messages es requerido y debe ser un array.' 
    });
  }
 
  const invalido = messages.some(
    (m) => !m.role || !['user', 'assistant', 'system'].includes(m.role)
  );
  
  if (invalido) {
    return res.status(400).json({ 
      error: 'Formato de mensajes inválido.' 
    });
  }
 
  
 
  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      max_tokens: 300,
      temperature: 0.3,
      messages: conversationHistory,
      tools: herramientasActivas,
      tool_choice: "auto"
    });
 
    let responseMessage = completion.choices[0].message;
    const toolCalls = responseMessage.tool_calls;
 
    if (toolCalls) {
      conversationHistory.push(responseMessage);
 
      for (const toolCall of toolCalls) {
        const functionName = toolCall.function.name;
        const args = JSON.parse(toolCall.function.arguments);
        let functionResponse;
 
        // ✅ MANEJAR HERRAMIENTA: generar_enlace_formulario_corporativo
        if (functionName === "generar_enlace_formulario_corporativo") {
          // Validar que se haya enviado un ID numérico válido retornado previamente
          if (!args.id_reserva_base || isNaN(args.id_reserva_base)) {
            functionResponse = {
              success: false,
              message: "ERROR: Faltan datos o el 'id_reserva_base' no es válido. Recuerda llamar primero a 'confirmar_y_guardar_reserva', esperar a que sea exitoso, y usar su 'reservaId'."
            };
            console.log('❌ Intento de generar enlace corporativo bloqueado por ID inválido:', args.id_reserva_base);
          } else {
            // Usamos directamente el ID de la reserva en la URL para evitar que el texto
            // desborde el contenedor del chat y relacionarlo de forma exacta con la BD.
            const enlaceFormulario = `${frontendUrl}/formulario-invitados/${args.id_reserva_base}`;
   
            functionResponse = {
              success: true,
              message: "Formulario corporativo generado exitosamente",
              enlace: enlaceFormulario,
              datosReserva: {
                id_reserva_base: args.id_reserva_base,
                ruc: args.ruc,
                nombre: args.nombre,
                fecha: args.fecha,
                hora: args.hora,
                motivo: args.motivo
              }
            };
   
            console.log('✅ Enlace generado para:', args.nombre);
          }
 
        } else if (functionName === "obtener_datos_dni") {
          functionResponse = await consultarDni(args.dni);
          if (!functionResponse.success) {
            functionResponse = { 
              status: "error",
              mensaje: functionResponse.message || "No disponible",
              instruccion: "Por favor, proporciona tu nombre manualmente."
            };
          }
 
        } else if (functionName === "obtener_datos_ruc") {
          functionResponse = await consultarRuc(args.ruc);
          if (!functionResponse || !functionResponse.success) {
            functionResponse = {
              status: "error",
              mensaje: functionResponse?.message || "RUC no encontrado",
              instruccion: "Por favor, verifica el RUC ingresado."
            };
          }
 
        } else if (functionName === "confirmar_y_guardar_reserva") {
          const datosIA = JSON.parse(toolCall.function.arguments);
          const resultado = await GuardarReserva(datosIA);
          
          if (resultado.success && resultado.insertId) {
            functionResponse = { 
              success: true, 
              message: "Reserva guardada correctamente",
              reservaId: resultado.insertId,
              linkFormulario: resultado.linkFormulario || null
            };
          } else {
            functionResponse = { 
              success: false, 
              message: resultado.message || "Error al guardar la reserva"
            };
          }
 
        } else if (functionName === "registrar_transaccion") {
          functionResponse = {
            success: true,
            message: "Transacción registrada correctamente"
          };
        } else {
          functionResponse = {
            status: "error",
            message: "Función no reconocida"
          };
        }
 
        // ✅ Validar que functionResponse siempre tenga contenido
        if (!functionResponse) {
          functionResponse = {
            status: "error",
            message: "No se pudo procesar la función"
          };
        }
 
        conversationHistory.push({
          tool_call_id: toolCall.id,
          role: "tool",
          name: functionName,
          content: JSON.stringify(functionResponse)
        });
      }
 
      // ✅ SEGUNDA LLAMADA A OPENAI
      const secondResponse = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: conversationHistory
      });
 
      const finalContent = secondResponse.choices[0].message.content;
      if (!finalContent) {
        return res.status(500).json({
          error: 'La IA no retornó una respuesta válida'
        });
      }
 
      return res.status(200).json({ 
        result: secondResponse.choices[0].message 
      });
    }
 
    // ✅ RESPUESTA SIN TOOL CALLS
    const directContent = completion.choices[0].message.content;
    if (!directContent) {
      return res.status(500).json({
        error: 'La IA no retornó una respuesta válida'
      });
    }
 
    return res.status(200).json({ 
      result: completion.choices[0].message 
    });
  
  } catch (error) {
    console.error('❌ Error OpenAI:', error?.message || error);
 
    const esConfigError = error?.status === 401 || error?.status === 429;
 
    return res.status(500).json({
      error: esConfigError
        ? 'El servicio de IA no está disponible en este momento'
        : 'Error interno al procesar su solicitud'
    });
  }
};
 