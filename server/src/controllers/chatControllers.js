
import OpenAI from "openai";
import { SYSTEM_PROMPT } from "../config/prompts.js";
import { GuardarReserva } from "./adminControllers.js";
import dotenv from "dotenv";

dotenv.config();

const frontendUrl = process.env.FRONTEND_URL || "http://localhost:5173";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Herramientas disponibles para el agente
const toolsComunes = [
  {
    type: "function",
    function: {
      name: "confirmar_y_guardar_reserva",
      description:
        "Registra una reserva personal, corporativa o de un visitante extranjero después de recopilar los datos y recibir la confirmación explícita del comensal.",
      parameters: {
        type: "object",
        properties: {
          tipo_cliente: {
            type: "string",
            enum: ["personal", "corporativa", "extranjero"],
          },
          identificador_fiscal: {
            type: ["string", "null"],
            description:
              "Dato opcional. No solicitar DNI ni RUC para reservar. Enviar null cuando no exista.",
          },
          nombre_cliente: {
            type: "string",
            description:
              "Nombre del comensal o responsable de la reserva. Para reservas corporativas puede incluir el nombre de la empresa.",
          },
          telefono: {
            type: "string",
          },
          correo: {
            type: ["string", "null"],
          },
          numero_personas: {
            type: "integer",
            minimum: 1,
          },
          fecha: {
            type: "string",
            description: "Fecha en formato YYYY-MM-DD.",
          },
          hora: {
            type: "string",
            description: "Hora en formato HH:MM.",
          },
          motivo: {
            type: "string",
          },
          metodo_pago: {
            type: ["string", "null"],
            enum: ["Yape", "Tarjeta", "Transferencia", null],
            description:
              "Método del adelanto, si existe. No significa que el pago haya sido verificado.",
          },
          monto: {
            type: ["number", "null"],
            description: "Monto del adelanto, si corresponde.",
          },
          id_pago_transaccion: {
            type: ["string", "null"],
            description:
              "Referencia de la transacción proporcionada por el cliente. No constituye verificación del pago.",
          },
        },
        required: [
          "tipo_cliente",
          "nombre_cliente",
          "telefono",
          "numero_personas",
          "fecha",
          "hora",
        ],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "registrar_transaccion",
      description:
        "Recibe los datos declarados de un adelanto. No verifica ni confirma el pago.",
      parameters: {
        type: "object",
        properties: {
          metodo: {
            type: "string",
            enum: ["Yape", "Tarjeta", "Transferencia"],
          },
          id_transaccion: {
            type: "string",
          },
          monto: {
            type: "number",
            minimum: 0.01,
          },
        },
        required: ["metodo", "id_transaccion", "monto"],
      },
    },
  },
];

const toolsCorporativas = [
  {
    type: "function",
    function: {
      name: "generar_enlace_formulario_corporativo",
      description:
        "Recupera el enlace del formulario de invitados de una reserva corporativa previamente guardada.",
      parameters: {
        type: "object",
        properties: {
          id_reserva_base: {
            type: "integer",
            description: "ID de la reserva corporativa registrada.",
          },
          ruc: {
            type: ["string", "null"],
            description: "Dato opcional.",
          },
          nombre: {
            type: "string",
          },
          fecha: {
            type: "string",
          },
          hora: {
            type: "string",
          },
          motivo: {
            type: "string",
          },
        },
        required: ["id_reserva_base"],
      },
    },
  },
];

const sanitizeMessages = (messages) => {
  return messages
    .filter( (msg) => msg && ["user", "assistant"].includes(msg.role) && typeof msg.content === "string" && msg.content.trim()
    ) .map((msg) => ({
      role: msg.role,
      content: msg.content.trim(),
    }));
};

const detectarTipoCliente = (messages) => {
  const historialUsuario = messages
    .filter((msg) => msg.role === "user")
    .map((msg) => msg.content || "")
    .join(" ")
    .toLowerCase();

  if ( historialUsuario.includes("corporativa") || historialUsuario.includes("empresa") || historialUsuario.includes("empresarial") ) {
    return "corporativa";
  }

  if ( historialUsuario.includes("extranjero") || historialUsuario.includes("no peruano") || historialUsuario.includes("turista")) {
    return "extranjero";
  }

  return "personal";
};

const normalizarDatosReserva = (args) => {
  const datos = { ...args };

  if (!datos.identificador_fiscal) {
    datos.identificador_fiscal = null;
  }

  if (!datos.correo) {
    datos.correo = null;
  }

  if (!datos.motivo) {
    datos.motivo = "Reserva estándar";
  }

  if (!datos.metodo_pago) {
    datos.metodo_pago = null;
  }

  if (!datos.id_pago_transaccion) {
    datos.id_pago_transaccion = null;
  }

  if (datos.monto === undefined || datos.monto === "") {
    datos.monto = null;
  }

  return datos;
};

export const chatController = async (req, res) => {
  const { messages } = req.body || {};

  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({
      error: "El campo messages es requerido y debe ser un array.",
    });
  }

  const mensajesInvalidos = messages.some( (msg) => !msg || !["user", "assistant"].includes(msg.role) || typeof msg.content !== "string" );

  if (mensajesInvalidos) {
    return res.status(400).json({
      error: "Formato de mensajes inválido.",
    });
  }

  const historial = sanitizeMessages(messages);

  if (!historial.some((msg) => msg.role === "user")) {
    return res.status(400).json({
      error: "Se requiere al menos un mensaje del usuario.",
    });
  }

  const clienteFinal = detectarTipoCliente(historial);

  const herramientasActivas =
    clienteFinal === "corporativa"
      ? [...toolsComunes, ...toolsCorporativas]
      : [...toolsComunes];

  const mainSystemPrompt = `${SYSTEM_PROMPT}

REGLAS OPERATIVAS DEL SISTEMA:

1. No solicites DNI ni RUC para registrar reservas.
2. No consultes RENIEC, SUNAT ni servicios de identificación.
3. Recopila nombre, teléfono, fecha, hora y cantidad de personas.
4. Para reservas corporativas solicita también los datos de contacto y de la empresa definidos en el flujo.
5. Solicita únicamente los datos que falten.
6. Antes de guardar, muestra un resumen y solicita confirmación explícita.
7. No ejecutes confirmar_y_guardar_reserva antes de esa confirmación.
8. No inventes disponibilidad de mesas.
9. No afirmes que una reserva está confirmada si el backend no devolvió un resultado exitoso.
10. No afirmes que un pago está verificado por recibir un identificador de transacción.

RESERVAS CORPORATIVAS:

1. Guarda primero la reserva mediante confirmar_y_guardar_reserva.
2. Si la herramienta devuelve linkFormulario, utiliza exactamente ese enlace.
3. No inventes, modifiques ni acortes enlaces.
4. No vuelvas a guardar una reserva para generar su formulario.
5. No solicites RUC como requisito para obtener el enlace.

PAGOS:

1. Los adelantos son opcionales.
2. No proceses pagos directamente.
3. Un comprobante o referencia no demuestra que el dinero haya sido recibido.
4. Si el sistema no verifica pagos, informa que quedan pendientes de revisión.
`;

  const conversationHistory = [
    { role: "system", content: mainSystemPrompt },
    ...historial,
  ];

  const ultimoMensaje = [...historial]
    .reverse()
    .find((msg) => msg.role === "user");

  console.log(
    "Nuevo mensaje recibido:",
    ultimoMensaje?.content?.substring(0, 50) || "Sin contenido"
  );

  console.log("Tipo de cliente detectado:", clienteFinal);

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      max_tokens: 500,
      temperature: 0.3,
      messages: conversationHistory,
      tools: herramientasActivas,
      tool_choice: "auto",
      parallel_tool_calls: false,
    });

    const responseMessage = completion.choices[0]?.message;

    if (!responseMessage) {
      return res.status(502).json({
        error: "El asistente no devolvió una respuesta válida.",
      });
    }

    const toolCalls = responseMessage.tool_calls;

    if (toolCalls?.length) {
      conversationHistory.push(responseMessage);

      for (const toolCall of toolCalls) {
        const functionName = toolCall.function.name;
        let functionResponse;

        try {
          const args = JSON.parse(toolCall.function.arguments || "{}");

          switch (functionName) {
            case "confirmar_y_guardar_reserva": {
              const datosReserva = normalizarDatosReserva(args);

              const resultado = await GuardarReserva(datosReserva);

              if (resultado?.success && resultado.insertId) {
                functionResponse = {
                  success: true,
                  message: "Reserva registrada correctamente.",
                  reservaId: resultado.insertId,
                  linkFormulario: resultado.linkFormulario || null,
                };
              } else {
                functionResponse = {
                  success: false,
                  message:
                    resultado?.message ||
                    "No fue posible registrar la reserva.",
                };
              }

              break;
            }

            case "generar_enlace_formulario_corporativo": {
              // El enlace ya se genera en GuardarReserva.
              functionResponse = {
                success: false,
                message:
                  "El enlace corporativo se obtiene al guardar la reserva. Utilice el linkFormulario devuelto por confirmar_y_guardar_reserva.",
              };

              break;
            }

            case "registrar_transaccion": {
              functionResponse = {
                success: false,
                verificado: false,
                message:
                  "Referencia recibida, pero no registrada ni verificada. El adelanto debe ser revisado por el restaurante.",
              };

              break;
            }

            default:
              functionResponse = {
                success: false,
                message: "Función no reconocida.",
              };
          }
        } catch (error) {
          console.error(
            `Error ejecutando ${functionName}:`,
            error.message
          );

          functionResponse = {
            success: false,
            message: "No se pudo ejecutar la operación solicitada.",
          };
        }

        conversationHistory.push({
          tool_call_id: toolCall.id,
          role: "tool",
          name: functionName,
          content: JSON.stringify(functionResponse),
        });
      }

      const secondResponse = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        max_tokens: 500,
        temperature: 0.3,
        messages: conversationHistory,
        tool_choice: "none",
      });

      const finalAssistantMessage = secondResponse.choices[0]?.message;

      if (!finalAssistantMessage?.content) {
        return res.status(502).json({
          error: "La IA no retornó una respuesta válida.",
        });
      }

      return res.status(200).json({
        result: finalAssistantMessage,
      });
    }

    if (!responseMessage.content) {
      return res.status(502).json({
        error: "La IA no retornó una respuesta válida.",
      });
    }

    return res.status(200).json({
      result: responseMessage,
    });
  } catch (error) {
    console.error("Error OpenAI:", error?.message || error);

    const esConfigError = error?.status === 401 || error?.status === 429;

    return res.status(500).json({
      error: esConfigError
        ? "El servicio de IA no está disponible en este momento."
        : "Error interno al procesar su solicitud.",
    });
  }
};
