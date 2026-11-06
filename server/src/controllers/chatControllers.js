
import OpenAI from "openai";
import dotenv from "dotenv";
import { SYSTEM_PROMPT } from "../config/prompts.js";
import { GuardarReserva } from "./adminControllers.js";

dotenv.config();

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  timeout: 30000,
  maxRetries: 1,
});

const MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";
const MAX_MESSAGES = 60;
const MAX_MESSAGE_LENGTH = 4000;

const tools = [
  {
    type: "function",
    function: {
      name: "confirmar_y_guardar_reserva",
      description:
        "Registra una solicitud de reserva después de mostrar un resumen y recibir la confirmación explícita del comensal. Los adelantos requieren método, monto y referencia. No verifica pagos ni confirma disponibilidad.",
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
              "Campo opcional por compatibilidad. No solicitar DNI ni RUC. Enviar null.",
          },
          nombre_cliente: {
            type: "string",
            description:
              "Nombre completo del responsable. Para reservas corporativas puede incluir la empresa.",
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
            description: "Fecha YYYY-MM-DD.",
          },
          hora: {
            type: "string",
            description: "Hora HH:MM en horario de Lima.",
          },
          motivo: {
            type: "string",
          },
          metodo_pago: {
            type: ["string", "null"],
            enum: ["Yape", "Tarjeta", "Transferencia", null],
            description:
              "Método del adelanto. Null si no existe adelanto.",
          },
          monto: {
            type: ["number", "null"],
            description:
              "Monto del adelanto declarado. Null si no existe.",
          },
          id_pago_transaccion: {
            type: ["string", "null"],
            description:
              "Referencia declarada por el comensal. No implica verificación bancaria.",
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
];

const texto = (valor) =>
  typeof valor === "string" ? valor.trim() : "";

const normalizarTexto = (valor) =>
  texto(valor)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

const sanitizeMessages = (messages) =>
  messages
    .filter(
      (msg) =>
        msg &&
        ["user", "assistant"].includes(msg.role) &&
        typeof msg.content === "string" &&
        msg.content.trim()
    )
    .map(({ role, content }) => ({
      role,
      content: content.trim(),
    }));

const esConfirmacion = (mensaje) => {
  const valor = normalizarTexto(mensaje);

  return /^(si|si correcto|correcto|confirmo|confirmado|confirmar|confirmar reserva|confirmo la reserva|si confirmo|si confirmo la reserva|esta correcto|todo correcto|de acuerdo|yes|yes confirm|i confirm|confirmed|correct|ok|okay|vale|listo|adelante|proceda|puede registrarla)[.! ]*$/.test(
    valor
  );
};

const tieneResumenPrevio = (historial) => {
  const ultimoUsuario = historial.findLastIndex(
    (msg) => msg.role === "user"
  );

  if (ultimoUsuario < 1) return false;

  const anterior = historial
    .slice(0, ultimoUsuario)
    .reverse()
    .find((msg) => msg.role === "assistant");

  if (!anterior) return false;

  const contenido = normalizarTexto(anterior.content);

  const tieneFecha = /fecha|date|dia/.test(contenido);
  const tieneHora = /hora|time/.test(contenido);
  const tienePersonas = /persona|comensal|asistente|guest|people/.test(
    contenido
  );

  return tieneFecha && tieneHora && tienePersonas;
};

const validarFecha = (fecha) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return false;

  const [year, month, day] = fecha.split("-").map(Number);
  const fechaUTC = new Date(Date.UTC(year, month - 1, day));

  return (
    fechaUTC.getUTCFullYear() === year &&
    fechaUTC.getUTCMonth() === month - 1 &&
    fechaUTC.getUTCDate() === day
  );
};

const obtenerFechaLima = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Lima",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

const validarHorario = (fecha, hora) => {
  if (!/^\d{2}:\d{2}$/.test(hora)) {
    return "La hora debe tener formato HH:MM.";
  }

  const [h, m] = hora.split(":").map(Number);

  if (h > 23 || m > 59) {
    return "La hora indicada no es válida.";
  }

  const minutos = h * 60 + m;
  const [year, month, day] = fecha.split("-").map(Number);
  const diaSemana = new Date(
    Date.UTC(year, month - 1, day)
  ).getUTCDay();

  if (diaSemana === 0) {
    if (minutos < 720 || minutos > 1020) {
      return "Los domingos atendemos de 12:00 a 17:00.";
    }
  } else if (minutos < 750 || minutos > 1320) {
    return "De lunes a sábado atendemos de 12:30 a 22:00.";
  }

  if (diaSemana !== 0 && minutos > 975 && minutos < 1050) {
    return "Entre 16:15 y 17:30 solo se ofrece coctelería.";
  }

  return null;
};

const normalizarDatosReserva = (args) => ({
  tipo_cliente: texto(args.tipo_cliente).toLowerCase(),
  identificador_fiscal: null,
  nombre_cliente: texto(args.nombre_cliente),
  telefono: texto(args.telefono),
  correo: texto(args.correo) || null,
  numero_personas: Number(args.numero_personas),
  fecha: texto(args.fecha),
  hora: texto(args.hora),
  motivo: texto(args.motivo) || "Reserva estándar",
  metodo_pago: texto(args.metodo_pago) || null,
  monto: args.monto == null ? null : Number(args.monto),
  id_pago_transaccion: texto(args.id_pago_transaccion) || null,
});

const validarReserva = (datos) => {
  const tipos = ["personal", "corporativa", "extranjero"];

  if (!tipos.includes(datos.tipo_cliente)) {
    return "El tipo de reserva no es válido.";
  }

  if (!datos.nombre_cliente || !datos.telefono) {
    return "Faltan el nombre o el teléfono del responsable.";
  }

  if (
    !Number.isInteger(datos.numero_personas) ||
    datos.numero_personas < 1
  ) {
    return "La cantidad de personas no es válida.";
  }

  if (!validarFecha(datos.fecha)) {
    return "La fecha de reserva no es válida.";
  }

  if (datos.fecha < obtenerFechaLima()) {
    return "La fecha de reserva no puede ser anterior a hoy.";
  }

  const errorHorario = validarHorario(datos.fecha, datos.hora);
  if (errorHorario) return errorHorario;

  if (datos.monto !== null) {
    if (!Number.isFinite(datos.monto) || datos.monto < 0) {
      return "El monto del adelanto no es válido.";
    }
  }

  const tieneAdelanto = datos.monto !== null && datos.monto > 0;

  if (tieneAdelanto) {
    if (
      !["Yape", "Tarjeta", "Transferencia"].includes(
        datos.metodo_pago
      )
    ) {
      return "Debe indicar un método de adelanto válido.";
    }

    if (!datos.id_pago_transaccion) {
      return "Debe proporcionar el número de operación del adelanto.";
    }
  } else {
    if (datos.metodo_pago || datos.id_pago_transaccion) {
      return "Debe aclarar el monto del adelanto declarado.";
    }

    datos.monto = null;
    datos.metodo_pago = null;
    datos.id_pago_transaccion = null;
  }

  return null;
};

const respuesta = (res, content, status = 200) =>
  res.status(status).json({
    result: {
      role: "assistant",
      content,
    },
  });

const crearPrompt = () => {
  const fechaActual = obtenerFechaLima();

  return `${SYSTEM_PROMPT}

REGLAS OPERATIVAS OBLIGATORIAS:

- Hoy en Lima es ${fechaActual}.
- No solicites DNI, RUC, pasaporte ni otros documentos.
- No consultes servicios de identificación.
- No inventes información ni resultados.
- Recopila los datos de la reserva progresivamente.
- No repitas preguntas ya respondidas.
- El adelanto es opcional.
- Si el comensal declara un adelanto, solicita método, monto y referencia.
- No afirmes que un adelanto fue verificado.
- No prometas disponibilidad de mesas.
- Antes de guardar, presenta un resumen completo.
- Espera confirmación explícita del comensal.
- Utiliza confirmar_y_guardar_reserva una sola vez.
- No ejecutes herramientas para consultar DNI o RUC.
- Si el registro falla, explica que la solicitud no fue guardada.
- Si el registro funciona, informa que está pendiente de confirmación del restaurante.
- Si se devuelve linkFormulario, comparte exactamente ese enlace.
- No inventes códigos de reserva ni enlaces.
- No comuniques que una reserva está confirmada por el restaurante sin evidencia.
- Si se produce un error técnico, no solicites nuevamente documentos.
`;
};

export const chatController = async (req, res) => {
  const { messages } = req.body || {};

  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({
      error: "Debe proporcionar un historial de mensajes.",
    });
  }

  if (
    messages.length > MAX_MESSAGES ||
    messages.some(
      (msg) =>
        !msg ||
        !["user", "assistant"].includes(msg.role) ||
        typeof msg.content !== "string" ||
        msg.content.length > MAX_MESSAGE_LENGTH
    )
  ) {
    return res.status(400).json({
      error: "El historial de mensajes no es válido.",
    });
  }

  const historial = sanitizeMessages(messages);

  if (!historial.length || historial.at(-1).role !== "user") {
    return res.status(400).json({
      error: "El último mensaje debe ser del comensal.",
    });
  }

  const ultimoMensaje = historial.at(-1).content;

  const conversationHistory = [
    {
      role: "system",
      content: crearPrompt(),
    },
    ...historial,
  ];

  try {
    const completion = await openai.chat.completions.create({
      model: MODEL,
      messages: conversationHistory,
      tools,
      tool_choice: "auto",
      parallel_tool_calls: false,
      temperature: 0.3,
      max_tokens: 650,
    });

    const responseMessage = completion.choices[0]?.message;

    if (!responseMessage) {
      return respuesta(
        res,
        "Disculpe, no pude procesar su solicitud. Inténtelo nuevamente.",
        502
      );
    }

    const toolCalls = responseMessage.tool_calls || [];

    if (!toolCalls.length) {
      return respuesta(
        res,
        responseMessage.content ||
          "Disculpe, no pude generar una respuesta."
      );
    }

    const confirmado =
      esConfirmacion(ultimoMensaje) &&
      tieneResumenPrevio(historial);

    const resultados = [];
    let reservaGuardada = false;

    for (const toolCall of toolCalls) {
      const nombreFuncion = toolCall.function?.name;

      if (nombreFuncion !== "confirmar_y_guardar_reserva") {
        resultados.push({
          success: false,
          code: "HERRAMIENTA_NO_PERMITIDA",
          message: "La operación solicitada no está disponible.",
        });
        continue;
      }

      if (!confirmado) {
        resultados.push({
          success: false,
          code: "CONFIRMACION_REQUERIDA",
          message:
            "Debe mostrar un resumen de la reserva y solicitar confirmación explícita antes de guardarla.",
        });
        continue;
      }

      if (reservaGuardada) {
        resultados.push({
          success: false,
          code: "RESERVA_YA_PROCESADA",
          message: "Esta solicitud ya fue procesada.",
        });
        continue;
      }

      let args;

      try {
        args = JSON.parse(toolCall.function.arguments || "{}");
      } catch {
        resultados.push({
          success: false,
          code: "ARGUMENTOS_INVALIDOS",
          message: "Los datos recibidos no tienen un formato válido.",
        });
        continue;
      }

      const datosReserva = normalizarDatosReserva(args);
      const errorValidacion = validarReserva(datosReserva);

      if (errorValidacion) {
        resultados.push({
          success: false,
          code: "VALIDACION_FALLIDA",
          message: errorValidacion,
        });
        continue;
      }

      try {
        const resultado = await GuardarReserva(datosReserva);

        if (!resultado?.success || !resultado.insertId) {
          resultados.push({
            success: false,
            code: "ERROR_REGISTRO",
            message:
              resultado?.message ||
              "No fue posible registrar la solicitud.",
          });
          continue;
        }

        reservaGuardada = true;

        resultados.push({
          success: true,
          reservaId: resultado.insertId,
          estado_reserva: "pendiente_confirmacion",
          estado_pago: datosReserva.monto
            ? "pendiente_verificacion"
            : "sin_adelanto",
          linkFormulario: resultado.linkFormulario || null,
          message:
            "Solicitud registrada. El restaurante se comunicará con el comensal para confirmar la reserva.",
        });
      } catch (error) {
        console.error("Error guardando reserva:", error.message);

        resultados.push({
          success: false,
          code: "ERROR_PERSISTENCIA",
          message:
            "No fue posible completar el registro. El restaurante debe revisar la solicitud.",
        });
      }
    }

    const mensajesHerramientas = toolCalls.map((call, index) => ({
      role: "tool",
      tool_call_id: call.id,
      content: JSON.stringify(
        resultados[index] || {
          success: false,
          message: "Operación no procesada.",
        }
      ),
    }));

    const secondResponse = await openai.chat.completions.create({
      model: MODEL,
      messages: [
        ...conversationHistory,
        responseMessage,
        ...mensajesHerramientas,
      ],
      temperature: 0.3,
      max_tokens: 650,
    });

    const mensajeFinal =
      secondResponse.choices[0]?.message?.content;

    if (!mensajeFinal) {
      return respuesta(
        res,
        "La solicitud fue procesada, pero no pude generar una respuesta. Comuníquese con el restaurante para verificar su estado.",
        502
      );
    }

    return respuesta(res, mensajeFinal);
  } catch (error) {
    console.error("Error OpenAI:", {
      status: error.status,
      code: error.code,
      message: error.message,
    });

    return respuesta(
      res,
      "Disculpe, nuestro asistente presenta un inconveniente temporal. Inténtelo nuevamente en unos momentos.",
      503
    );
  }
};
