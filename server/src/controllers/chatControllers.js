
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
const SESION_TTL = 60 * 60 * 1000;
const MAX_SESIONES = 2000;

const sesiones = new Map();

const CAMPOS = [
  "tipo_cliente",
  "nombre_cliente",
  "telefono",
  "correo",
  "numero_personas",
  "fecha",
  "hora",
  "motivo",
  "metodo_pago",
  "monto",
  "id_pago_transaccion",
];

const crearDatos = () => ({
  tipo_cliente: null,
  identificador_fiscal: null,
  nombre_cliente: null,
  telefono: null,
  correo: null,
  numero_personas: null,
  fecha: null,
  hora: null,
  motivo: null,
  metodo_pago: null,
  monto: null,
  id_pago_transaccion: null,
});

const crearSesion = () => ({
  datos: crearDatos(),
  estado: "recopilando",
  version: 0,
  versionConfirmada: null,
  resumenPendiente: false,
  reservaId: null,
  ultimaPeticion: null,
  ultimaRespuesta: null,
  actualizadoEn: Date.now(),
  ocupado: false,
});

const obtenerSesion = (id) => {
  const ahora = Date.now();

  for (const [key, sesion] of sesiones) {
    if (!sesion.ocupado && ahora - sesion.actualizadoEn > SESION_TTL) {
      sesiones.delete(key);
    }
  }

  if (!sesiones.has(id)) {
    if (sesiones.size >= MAX_SESIONES) {
      throw new Error("CAPACIDAD_SESIONES");
    }
    sesiones.set(id, crearSesion());
  }

  const sesion = sesiones.get(id);
  sesion.actualizadoEn = ahora;
  return sesion;
};

const limpiarTexto = (valor) =>
  typeof valor === "string" ? valor.trim() : "";

const normalizarTexto = (valor) =>
  limpiarTexto(valor)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

const fechaLima = () => {
  const partes = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Lima",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date());

  const valor = (tipo) =>
    partes.find((parte) => parte.type === tipo)?.value;

  return {
    fecha: `${valor("year")}-${valor("month")}-${valor("day")}`,
    hora: `${valor("hour")}:${valor("minute")}`,
  };
};

const fechaValida = (valor) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(valor || "")) return false;

  const [y, m, d] = valor.split("-").map(Number);
  const fecha = new Date(Date.UTC(y, m - 1, d));

  return (
    fecha.getUTCFullYear() === y &&
    fecha.getUTCMonth() === m - 1 &&
    fecha.getUTCDate() === d
  );
};

const horaValida = (valor) => {
  if (!/^\d{2}:\d{2}$/.test(valor || "")) return false;
  const [h, m] = valor.split(":").map(Number);
  return h >= 0 && h <= 23 && m >= 0 && m <= 59;
};

const validarHorario = (datos) => {
  if (!datos.fecha || !datos.hora) return null;

  if (!fechaValida(datos.fecha)) {
    return "La fecha indicada no es válida.";
  }

  if (!horaValida(datos.hora)) {
    return "La hora indicada no es válida.";
  }

  const ahora = fechaLima();

  if (
    datos.fecha < ahora.fecha ||
    (datos.fecha === ahora.fecha && datos.hora <= ahora.hora)
  ) {
    return "La fecha y hora de la reserva deben ser futuras.";
  }

  const [y, m, d] = datos.fecha.split("-").map(Number);
  const domingo = new Date(Date.UTC(y, m - 1, d)).getUTCDay() === 0;
  const [h, min] = datos.hora.split(":").map(Number);
  const minutos = h * 60 + min;

  if (domingo) {
    if (minutos < 720 || minutos >= 1020) {
      return "Los domingos atendemos de 12:00 p. m. a 5:00 p. m. ¿Qué otra hora prefiere?";
    }
    return null;
  }

  if (minutos < 750 || minutos >= 1320) {
    return "De lunes a sábado atendemos de 12:30 p. m. a 10:00 p. m. ¿Qué otra hora prefiere?";
  }

  if (minutos >= 975 && minutos < 1050) {
    return "A esa hora ofrecemos únicamente coctelería. Para disfrutar de la cena, podemos recibirle desde las 5:30 p. m. ¿Desea cambiar la hora?";
  }

  return null;
};

const normalizarCampo = (campo, valor) => {
  if (valor === undefined) return undefined;
  if (valor === null) return null;

  if (campo === "numero_personas") {
    const n = Number(valor);
    return Number.isInteger(n) && n > 0 ? n : undefined;
  }

  if (campo === "monto") {
    const n = Number(valor);
    return Number.isFinite(n) && n >= 0 ? n : undefined;
  }

  if (typeof valor !== "string") return undefined;

  const limpio = valor.trim();
  if (!limpio) return null;

  if (campo === "tipo_cliente") {
    return ["personal", "corporativa", "extranjero"].includes(
      limpio.toLowerCase()
    )
      ? limpio.toLowerCase()
      : undefined;
  }

  if (campo === "metodo_pago") {
    const metodo = normalizarTexto(limpio);

    if (metodo === "yape") return "Yape";
    if (metodo === "tarjeta") return "Tarjeta";
    if (metodo === "transferencia") return "Transferencia";
    return undefined;
  }

  if (campo === "fecha") {
    return fechaValida(limpio) ? limpio : undefined;
  }

  if (campo === "hora") {
    return horaValida(limpio) ? limpio : undefined;
  }

  return limpio.slice(0, 250);
};

const actualizarDatos = (sesion, cambios) => {
  let actualizado = false;

  for (const campo of CAMPOS) {
    if (!Object.prototype.hasOwnProperty.call(cambios, campo)) {
      continue;
    }

    const nuevoValor = normalizarCampo(campo, cambios[campo]);

    if (nuevoValor === undefined) continue;

    if (sesion.datos[campo] !== nuevoValor) {
      sesion.datos[campo] = nuevoValor;
      actualizado = true;
    }
  }

  if (actualizado) {
    sesion.version++;
    sesion.resumenPendiente = false;
    sesion.versionConfirmada = null;

    if (sesion.estado !== "registrada") {
      sesion.estado = "recopilando";
    }
  }

  return actualizado;
};

const camposFaltantes = (datos) => {
  const requeridos = [
    "tipo_cliente",
    "nombre_cliente",
    "telefono",
    "numero_personas",
    "fecha",
    "hora",
    "motivo",
  ];

  if (datos.tipo_cliente === "corporativa") {
    requeridos.push("correo");
  }

  const faltantes = requeridos.filter((campo) => {
    const valor = datos[campo];
    return valor === null || valor === undefined || valor === "";
  });

  if (datos.monto !== null && datos.monto > 0) {
    for (const campo of ["metodo_pago", "id_pago_transaccion"]) {
      if (!datos[campo]) faltantes.push(campo);
    }
  }

  return faltantes;
};

const validarDatos = (datos) => {
  if (!["personal", "corporativa", "extranjero"].includes(datos.tipo_cliente)) {
    return "Debe indicar el tipo de reserva.";
  }

  if (!datos.nombre_cliente || !datos.telefono) {
    return "Faltan los datos de contacto.";
  }

  if (!/^\+?[\d\s()-]{7,20}$/.test(datos.telefono)) {
    return "El teléfono de contacto no tiene un formato válido.";
  }

  if (
    datos.correo &&
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(datos.correo)
  ) {
    return "El correo electrónico no es válido.";
  }

  if (
    !Number.isInteger(datos.numero_personas) ||
    datos.numero_personas < 1
  ) {
    return "La cantidad de comensales no es válida.";
  }

  const horario = validarHorario(datos);
  if (horario) return horario;

  if (datos.monto !== null && datos.monto < 0) {
    return "El monto del adelanto no es válido.";
  }

  if (datos.monto > 0) {
    if (!datos.metodo_pago || !datos.id_pago_transaccion) {
      return "Para registrar el adelanto se necesita el método y el número de operación.";
    }
  } else if (datos.metodo_pago || datos.id_pago_transaccion) {
    return "Es necesario aclarar el monto del adelanto.";
  }

  return null;
};

const herramientasExtraccion = [
  {
    type: "function",
    function: {
      name: "interpretar_mensaje",
      description:
        "Extrae solamente los datos nuevos o corregidos expresamente por el comensal. No inventes datos, no repitas campos sin cambios y no solicites documentos.",
      parameters: {
        type: "object",
        properties: {
          cambios: {
            type: "object",
            properties: {
              tipo_cliente: {
                type: ["string", "null"],
                enum: ["personal", "corporativa", "extranjero", null],
              },
              nombre_cliente: { type: ["string", "null"] },
              telefono: { type: ["string", "null"] },
              correo: { type: ["string", "null"] },
              numero_personas: { type: ["integer", "null"] },
              fecha: { type: ["string", "null"] },
              hora: { type: ["string", "null"] },
              motivo: { type: ["string", "null"] },
              metodo_pago: {
                type: ["string", "null"],
                enum: ["Yape", "Tarjeta", "Transferencia", null],
              },
              monto: { type: ["number", "null"] },
              id_pago_transaccion: { type: ["string", "null"] },
            },
            additionalProperties: false,
          },
          intencion: {
            type: "string",
            enum: [
              "reservar",
              "confirmar",
              "corregir",
              "cancelar",
              "consultar",
              "otra",
            ],
          },
          respuesta_corta: {
            type: ["string", "null"],
            description:
              "Solo para preguntas generales sobre el restaurante. No inventar disponibilidad, precios ni pagos.",
          },
        },
        required: ["cambios", "intencion", "respuesta_corta"],
        additionalProperties: false,
      },
    },
  },
];

const interpretarMensaje = async (mensaje, sesion, historial) => {
  const ahora = fechaLima();

  const completion = await openai.chat.completions.create({
    model: MODEL,
    temperature: 0,
    max_tokens: 450,
    messages: [
      {
        role: "system",
        content: `${SYSTEM_PROMPT}

TAREA ACTUAL: extraer información, no registrar reservas.

Fecha en Lima: ${ahora.fecha}.
Hora en Lima: ${ahora.hora}.

Datos ya recopilados:
${JSON.stringify(sesion.datos)}

Reglas:
- Extrae solo los campos nuevos o corregidos del último mensaje.
- Si el cliente ya indicó tres personas, no modifiques ese dato salvo corrección explícita.
- Interpreta "mañana", "este sábado" y fechas relativas usando la fecha de Lima.
- Convierte horas a HH:MM de 24 horas.
- Si el cliente cambia la hora, modifica únicamente hora.
- No infieras DNI, RUC ni identificadores fiscales.
- Si confirma el resumen sin modificar datos, usa intencion confirmar y cambios {}.
- Si responde "sí" a una propuesta de cambio de hora, utiliza el contexto inmediato para extraer la hora propuesta.
- Si rechaza o corrige un dato, usa intencion corregir.
- No confundas una aceptación de horario con la confirmación final de una reserva.
- No infieras pagos realizados.
- Un número de operación declarado no prueba que el pago se haya recibido.
- Nunca inventes datos ausentes.`,
      },
      ...historial.slice(-12),
      { role: "user", content: mensaje },
    ],
    tools: herramientasExtraccion,
    tool_choice: {
      type: "function",
      function: { name: "interpretar_mensaje" },
    },
    parallel_tool_calls: false,
  });

  const llamada = completion.choices[0]?.message?.tool_calls?.[0];

  if (!llamada?.function?.arguments) {
    throw new Error("EXTRACCION_SIN_RESULTADO");
  }

  const resultado = JSON.parse(llamada.function.arguments);

  return {
    cambios: resultado.cambios || {},
    intencion: resultado.intencion || "otra",
    respuesta_corta: resultado.respuesta_corta || null,
  };
};

const formatearHora = (hora) => {
  if (!hora) return "Sin definir";

  const [h, m] = hora.split(":").map(Number);
  const periodo = h >= 12 ? "p. m." : "a. m.";
  const hora12 = h % 12 || 12;

  return `${hora12}:${String(m).padStart(2, "0")} ${periodo}`;
};

const crearResumen = (datos) => {
  const lineas = [
    "Con mucho gusto. Le presento el resumen de su solicitud:",
    "",
    `Nombre: ${datos.nombre_cliente}`,
    `Teléfono: ${datos.telefono}`,
    `Tipo de reserva: ${datos.tipo_cliente}`,
    `Fecha: ${datos.fecha}`,
    `Hora: ${formatearHora(datos.hora)}`,
    `Número de comensales: ${datos.numero_personas}`,
    `Motivo: ${datos.motivo}`,
  ];

  if (datos.correo) {
    lineas.push(`Correo: ${datos.correo}`);
  }

  if (datos.monto > 0) {
    lineas.push(
      `Adelanto declarado: S/ ${datos.monto.toFixed(2)}`,
      `Método: ${datos.metodo_pago}`,
      `Referencia: ${datos.id_pago_transaccion}`,
      "El adelanto queda pendiente de verificación."
    );
  } else {
    lineas.push("Adelanto: No declarado");
  }

  lineas.push(
    "",
    "¿Son correctos estos datos y autoriza que registremos su solicitud de reserva?"
  );

  return lineas.join("\n");
};

const preguntas = {
  tipo_cliente:
    "¿Desea realizar una reserva personal o corporativa?",
  nombre_cliente:
    "¿Me indica su nombre completo, por favor?",
  telefono:
    "¿Podría facilitarme un número de teléfono de contacto?",
  correo:
    "¿A qué correo electrónico podemos enviarle la información de su reserva corporativa?",
  numero_personas:
    "¿Para cuántos comensales desea realizar la reserva?",
  fecha:
    "¿Para qué fecha desea realizar su reserva?",
  hora:
    "¿A qué hora le gustaría visitarnos?",
  motivo:
    "¿Cuál es el motivo de su visita? ¿Se trata de una celebración o de una ocasión especial?",
  metodo_pago:
    "¿Por qué medio realizó el adelanto: Yape, tarjeta o transferencia?",
  monto:
    "¿Qué monto de adelanto desea declarar?",
  id_pago_transaccion:
    "¿Podría indicarme el número de operación de su adelanto? Quedará pendiente de verificación.",
};

const responder = (res, contenido, sesion, status = 200) => {
  const payload = {
    result: {
      role: "assistant",
      content: contenido,
    },
    estado: sesion.estado,
  };

  res.status(status).json(payload);
  return payload;
};

const respuestaConsulta = async (mensaje, sesion) => {
  const completion = await openai.chat.completions.create({
    model: MODEL,
    temperature: 0.3,
    max_tokens: 300,
    messages: [
      {
        role: "system",
        content: `${SYSTEM_PROMPT}

Responda de manera breve, cálida y elegante.
Trate al comensal de usted.
No solicite DNI ni RUC.
No afirme que existe disponibilidad.
No invente precios, promociones ni pagos confirmados.
No registre reservas.
Datos ya recopilados: ${JSON.stringify(sesion.datos)}`,
      },
      { role: "user", content: mensaje },
    ],
  });

  return (
    completion.choices[0]?.message?.content ||
    "Con mucho gusto. ¿En qué puedo ayudarle?"
  );
};

const prepararDatosGuardar = (datos) => ({
  ...datos,
  identificador_fiscal: null,
  correo: datos.correo || null,
  monto: datos.monto || null,
  metodo_pago: datos.monto > 0 ? datos.metodo_pago : null,
  id_pago_transaccion:
    datos.monto > 0 ? datos.id_pago_transaccion : null,
});

export const chatController = async (req, res) => {
  const { sessionId, messages } = req.body || {};

  if (
    typeof sessionId !== "string" ||
    !/^[a-f0-9-]{36}$/i.test(sessionId)
  ) {
    return res.status(400).json({
      error: "Identificador de sesión inválido.",
    });
  }

  if (
    !Array.isArray(messages) ||
    messages.length === 0 ||
    messages.length > 60
  ) {
    return res.status(400).json({
      error: "Historial de conversación inválido.",
    });
  }

  const historial = messages.filter(
    (m) =>
      m &&
      ["user", "assistant"].includes(m.role) &&
      typeof m.content === "string" &&
      m.content.length <= 4000
  );

  if (historial.length !== messages.length) {
    return res.status(400).json({
      error: "El historial contiene mensajes inválidos.",
    });
  }

  const ultimo = historial.at(-1);

  if (!ultimo || ultimo.role !== "user" || !ultimo.content.trim()) {
    return res.status(400).json({
      error: "Se requiere un mensaje del comensal.",
    });
  }

  let sesion;

  try {
    sesion = obtenerSesion(sessionId);
  } catch {
    return res.status(503).json({
      error: "El servicio está ocupado. Inténtelo nuevamente.",
    });
  }

  if (sesion.ocupado) {
    return res.status(409).json({
      error: "Ya estamos procesando un mensaje de esta conversación.",
    });
  }

  const mensaje = ultimo.content.trim();
  const peticion = JSON.stringify(historial);

  if (
    sesion.ultimaPeticion === peticion &&
    sesion.ultimaRespuesta
  ) {
    return res.json(sesion.ultimaRespuesta);
  }

  sesion.ocupado = true;

  const enviar = (contenido, status = 200) => {
    const payload = responder(res, contenido, sesion, status);

    if (status === 200) {
      sesion.ultimaPeticion = peticion;
      sesion.ultimaRespuesta = payload;
    }

    return payload;
  };

  try {
    if (sesion.estado === "registrada") {
      return enviar(
        `Su solicitud ya fue registrada con el número ${sesion.reservaId}. El restaurante se comunicará con usted para confirmar la disponibilidad. ¿Puedo ayudarle con alguna otra consulta?`
      );
    }

    const interpretacion = await interpretarMensaje(
      mensaje,
      sesion,
      historial.slice(0, -1)
    );

    const estabaEsperandoConfirmacion =
      sesion.resumenPendiente &&
      sesion.versionConfirmada === sesion.version;

    const huboCambios = actualizarDatos(
      sesion,
      interpretacion.cambios
    );

    if (interpretacion.intencion === "cancelar") {
      sesion.datos = crearDatos();
      sesion.version++;
      sesion.resumenPendiente = false;
      sesion.versionConfirmada = null;
      sesion.estado = "recopilando";

      return enviar(
        "He descartado los datos de esta solicitud. Si desea comenzar una nueva reserva, será un placer atenderle."
      );
    }

    if (
      interpretacion.intencion === "consultar" &&
      !huboCambios
    ) {
      const contenido = await respuestaConsulta(mensaje, sesion);
      return enviar(contenido);
    }

    if (
      interpretacion.intencion === "confirmar" &&
      estabaEsperandoConfirmacion &&
      !huboCambios
    ) {
      const faltantes = camposFaltantes(sesion.datos);

      if (faltantes.length) {
        sesion.estado = "recopilando";
        sesion.resumenPendiente = false;
        return enviar(preguntas[faltantes[0]]);
      }

      const error = validarDatos(sesion.datos);

      if (error) {
        sesion.estado = "recopilando";
        sesion.resumenPendiente = false;
        return enviar(error);
      }

      sesion.estado = "registrando";

      let resultado;

      try {
        resultado = await GuardarReserva(
          prepararDatosGuardar(sesion.datos)
        );
      } catch (errorGuardar) {
        console.error("Error GuardarReserva:", errorGuardar);

        sesion.estado = "revision_manual";
        sesion.resumenPendiente = false;

        return enviar(
          "Se produjo un inconveniente al registrar su solicitud. No podemos asegurar si quedó guardada. Por favor, comuníquese con el restaurante antes de intentarlo nuevamente para evitar duplicados."
        );
      }

      if (!resultado?.success || !resultado?.insertId) {
        sesion.estado = "revision_manual";
        sesion.resumenPendiente = false;

        return enviar(
          "No hemos podido confirmar el registro de su solicitud. Nuestro equipo deberá revisar la situación antes de volver a intentarlo."
        );
      }

      sesion.estado = "registrada";
      sesion.reservaId = resultado.insertId;
      sesion.resumenPendiente = false;

      let contenido =
        `Muchas gracias, ${sesion.datos.nombre_cliente}. ` +
        `Su solicitud de reserva ha sido registrada con el número ${resultado.insertId}. ` +
        "Nuestro equipo se comunicará con usted para confirmar la disponibilidad de su mesa.";

      if (sesion.datos.monto > 0) {
        contenido +=
          " Hemos recibido la referencia de su adelanto, que permanece pendiente de verificación.";
      }

      if (resultado.linkFormulario) {
        contenido +=
          ` Puede completar la información adicional aquí: ` +
          `[Formulario de reserva](${resultado.linkFormulario}).`;
      }

      return enviar(contenido);
    }

    const faltantes = camposFaltantes(sesion.datos);
    const errorHorario = validarHorario(sesion.datos);

    if (errorHorario) {
      sesion.resumenPendiente = false;
      sesion.estado = "recopilando";

      return enviar(errorHorario);
    }

    if (faltantes.length > 0) {
      sesion.resumenPendiente = false;
      sesion.estado = "recopilando";

      return enviar(
        `Muchas gracias. ${preguntas[faltantes[0]]}`
      );
    }

    const errorValidacion = validarDatos(sesion.datos);

    if (errorValidacion) {
      sesion.estado = "recopilando";
      return enviar(errorValidacion);
    }

    if (
      sesion.resumenPendiente &&
      sesion.versionConfirmada === sesion.version
    ) {
      return enviar(
        "Ya tengo todos los datos de su solicitud. ¿Desea confirmar el registro con la información del resumen anterior?"
      );
    }

    sesion.estado = "esperando_confirmacion";
    sesion.resumenPendiente = true;
    sesion.versionConfirmada = sesion.version;

    return enviar(crearResumen(sesion.datos));
  } catch (error) {
    console.error("Error chatController:", {
      message: error.message,
      status: error.status,
      code: error.code,
    });

    return res.status(503).json({
      error: "El asistente no está disponible temporalmente.",
      result: {
        role: "assistant",
        content:
          "Disculpe, estamos experimentando un inconveniente técnico. Por favor, inténtelo nuevamente.",
      },
      estado: sesion.estado,
    });
  } finally {
    sesion.ocupado = false;
    sesion.actualizadoEn = Date.now();
  }
};
