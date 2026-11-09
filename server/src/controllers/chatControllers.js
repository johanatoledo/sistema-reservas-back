
import OpenAI from "openai";
import dotenv from "dotenv";
import { SYSTEM_PROMPT } from "../config/prompts.js";
import { GuardarReserva } from "./adminControllers.js";

dotenv.config();

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  timeout: 45000,
  maxRetries: 2,
});

const MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";
const SESION_TTL = 60 * 60 * 1000;
const MAX_SESIONES = 2000;
const MAX_HISTORIAL = 60;

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

const CAMPOS_PAGO = [
  "metodo_pago",
  "monto",
  "id_pago_transaccion",
];

const INTENCIONES = [
  "reservar",
  "confirmar",
  "consultar",
  "corregir",
  "cancelar",
  "informar_pago",
  "otra",
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
  consultaPendiente: false,
  reservaId: null,
  ultimaPeticion: null,
  ultimaRespuesta: null,
  actualizadoEn: Date.now(),
  ocupado: false,
});

const obtenerSesion = (id) => {
  const ahora = Date.now();

  for (const [key, sesion] of sesiones) {
    if ( !sesion.ocupado && ahora - sesion.actualizadoEn > SESION_TTL
    ) {
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

const normalizarTexto = (valor) => limpiarTexto(valor).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

const esConfirmacionDirecta = (mensaje) => {
  const texto = normalizarTexto(mensaje)
    .replace(/[.!¡¿?]/g, "")
    .trim();

  const confirmaciones = new Set([
    "si",
    "si claro",
    "si por favor",
    "confirmo",
    "confirmado",
    "correcto",
    "esta correcto",
    "todo correcto",
    "de acuerdo",
    "autorizo",
    "autorizo el registro",
    "puede registrar",
    "proceda con la reserva",
  ]);

  return confirmaciones.has(texto);
};

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

  const valor = (tipo) => partes.find((parte) => parte.type === tipo)?.value;

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
    return "La fecha indicada no es válida. ¿Podría confirmarla?";
  }

  if (!horaValida(datos.hora)) {
    return "La hora indicada no es válida. ¿Podría confirmarla?";
  }

  const ahora = fechaLima();

  if (
    datos.fecha < ahora.fecha ||
    (datos.fecha === ahora.fecha && datos.hora <= ahora.hora)
  ) {
    return "La fecha y hora deben ser futuras. ¿Qué otra fecha u hora prefiere?";
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
    const tipo = normalizarTexto(limpio);

    return ["personal", "corporativa", "extranjero"].includes(tipo)
      ? tipo
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

const invalidarResumen = (sesion) => {
  sesion.resumenPendiente = false;
  sesion.versionConfirmada = null;
  sesion.consultaPendiente = false;

  if (sesion.estado !== "registrada") {
    sesion.estado = "recopilando";
  }
};

const actualizarDatos = (sesion, cambios = {}) => {
  let actualizado = false;
  let cambioPago = false;

  for (const campo of CAMPOS) {
    if (!Object.prototype.hasOwnProperty.call(cambios, campo)) {
      continue;
    }

    const nuevoValor = normalizarCampo(campo, cambios[campo]);

    if (nuevoValor === undefined) continue;

    if (sesion.datos[campo] !== nuevoValor) {
      sesion.datos[campo] = nuevoValor;
      actualizado = true;

      if (CAMPOS_PAGO.includes(campo)) {
        cambioPago = true;
      }
    }
  }

  // Una nueva declaración de pago invalida referencias anteriores.
  if (cambioPago) {
    const cambioMetodo = Object.prototype.hasOwnProperty.call(cambios, "metodo_pago");
    const cambioMonto = Object.prototype.hasOwnProperty.call(cambios, "monto");
    const nuevaReferencia =
      Object.prototype.hasOwnProperty.call(
        cambios,
        "id_pago_transaccion"
      ) &&
      normalizarCampo(
        "id_pago_transaccion",
        cambios.id_pago_transaccion
      );

    if ((cambioMetodo || cambioMonto) && !nuevaReferencia) {
      if (sesion.datos.id_pago_transaccion !== null) {
        sesion.datos.id_pago_transaccion = null;
        actualizado = true;
      }
    }

    if (sesion.datos.monto === 0) {
      sesion.datos.metodo_pago = null;
      sesion.datos.id_pago_transaccion = null;
    }
  }

  if (actualizado) {
    sesion.version++;
    invalidarResumen(sesion);
  }

  return { actualizado, cambioPago };
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

  if (datos.monto > 0) {
    if (!datos.metodo_pago) faltantes.push("metodo_pago");
    if (!datos.id_pago_transaccion) {
      faltantes.push("id_pago_transaccion");
    }
  }

  if (
    (datos.metodo_pago || datos.id_pago_transaccion) &&
    datos.monto === null
  ) {
    faltantes.push("monto");
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

  if (datos.correo && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(datos.correo)) {
    return "El correo electrónico no es válido.";
  }

  if (!Number.isInteger(datos.numero_personas) || datos.numero_personas < 1) {
    return "La cantidad de comensales no es válida.";
  }

  const horario = validarHorario(datos);
  if (horario) return horario;

  if (datos.monto !== null && datos.monto < 0) {
    return "El monto del adelanto no es válido.";
  }

  if (datos.monto > 0) {
    if (!datos.metodo_pago || !datos.id_pago_transaccion) {
      return "Para registrar el adelanto necesitamos el método y el número de operación.";
    }
  } else if (datos.metodo_pago || datos.id_pago_transaccion) {
    return "Necesitamos aclarar el monto del adelanto.";
  }

  return null;
};

const herramientasExtraccion = [
  {
    type: "function",
    function: {
      name: "interpretar_mensaje",
      description:
        "Interpreta todas las intenciones del mensaje, detecta consultas, condiciones y correcciones, y extrae solo datos explícitos.",
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
          intenciones: {
            type: "array",
            items: {
              type: "string",
              enum: INTENCIONES,
            },
          },
          confirmacion_definitiva: {
            type: "boolean",
            description:
              "True solo si el usuario autoriza inequívocamente registrar el último resumen, sin preguntas, condiciones ni cambios.",
          },
          tiene_pregunta: {
            type: "boolean",
          },
          tiene_condicion: {
            type: "boolean",
          },
          consulta: {
            type: ["string", "null"],
            description:
              "Pregunta o duda concreta que debe responderse antes de continuar.",
          },
          requiere_aclaracion: {
            type: "boolean",
            description:
              "True si no es seguro interpretar el mensaje o una confirmación.",
          },
          desea_adelanto: {
            type: ["boolean", "null"],
            description:
              "True si quiere realizar adelanto, false si lo rechaza, null si no expresa decisión.",
          },
        },
        required: [
          "cambios",
          "intenciones",
          "confirmacion_definitiva",
          "tiene_pregunta",
          "tiene_condicion",
          "consulta",
          "requiere_aclaracion",
          "desea_adelanto",
        ],
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
    max_tokens: 650,
    messages: [
      {
        role: "system",
        content: `${SYSTEM_PROMPT}

FUNCIÓN ACTUAL: interpretar mensajes. No registrar reservas.

Fecha actual en Lima: ${ahora.fecha}
Hora actual en Lima: ${ahora.hora}

Datos confirmados o recopilados:
${JSON.stringify(sesion.datos)}

Estado: ${sesion.estado}
Resumen pendiente: ${sesion.resumenPendiente}
Consulta pendiente: ${sesion.consultaPendiente}

REGLAS PRIORITARIAS:

1. Un mensaje puede tener varias intenciones.
2. Extraiga solamente datos nuevos o correcciones explícitas.
3. No vuelva a extraer datos antiguos como si fueran nuevos.
4. No invente datos, pagos ni referencias de operación.
5. Interprete fechas relativas respecto a Lima.
6. Normalice fecha a YYYY-MM-DD y hora a HH:MM.
7. No solicite DNI ni RUC.
8. Una pregunta siempre debe identificarse aunque empiece con "sí".
9. Una aceptación condicionada NO es confirmación definitiva.
10. "Sí, pero antes..." implica confirmacion_definitiva false.
11. "Sí, ¿puedo dejar adelanto?" implica pregunta y no confirmación definitiva.
12. "Sí, confirmo" puede ser confirmación definitiva únicamente si se acaba de mostrar el resumen completo y no existen dudas.
13. Una aceptación de un horario sugerido no confirma la reserva completa.
14. Si el cliente cambia un dato, no confirme la versión anterior.
15. Si pregunta por adelantos, identifique consultar y la consulta.
16. Si proporciona un monto de adelanto, no asuma que el pago fue realizado.
17. Si proporciona una referencia, no asuma que el pago fue verificado.
18. No transforme una pregunta sobre adelantos en un adelanto declarado.
19. No cancele la solicitud salvo que el usuario pida expresamente cancelarla.
20. Si hay ambigüedad, requiere_aclaracion true.
21. Una respuesta afirmativa a una pregunta informativa no constituye necesariamente autorización para registrar.
22. Para confirmar, el cliente debe autorizar claramente el registro del último resumen presentado.

Devuelva los campos de la herramienta sin inventar información.`,
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

  if ( llamada?.function?.name !== "interpretar_mensaje" || !llamada.function.arguments ) {
    throw new Error("EXTRACCION_SIN_RESULTADO");
  }

  const resultado = JSON.parse(llamada.function.arguments);

  const intenciones = Array.isArray(resultado.intenciones)
    ? resultado.intenciones.filter((i) => INTENCIONES.includes(i))
    : [];

  return {
    cambios: resultado.cambios && typeof resultado.cambios === "object" && !Array.isArray(resultado.cambios)
        ? resultado.cambios
        : {},
    intenciones,
    confirmacion_definitiva: resultado.confirmacion_definitiva === true,
    tiene_pregunta: resultado.tiene_pregunta === true,
    tiene_condicion: resultado.tiene_condicion === true,
    consulta: typeof resultado.consulta === "string"
        ? resultado.consulta.trim()
        : null,
    requiere_aclaracion: resultado.requiere_aclaracion === true,
    desea_adelanto: typeof resultado.desea_adelanto === "boolean"
        ? resultado.desea_adelanto
        : null,
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
    "Con mucho gusto. Le presento el resumen actualizado de su solicitud:",
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
      `Número de operación: ${datos.id_pago_transaccion}`,
      "Estado del adelanto: Pendiente de verificación."
    );
  } else {
    lineas.push("Adelanto: No declarado.");
  }

  lineas.push( "", "¿Son correctos estos datos y autoriza que registremos su solicitud de reserva?" );

  return lineas.join("\n");
};

const preguntas = {
  tipo_cliente: "¿Desea realizar una reserva personal o corporativa?",
  nombre_cliente: "¿Podría indicarme su nombre completo, por favor?",
  telefono: "¿Podría facilitarme un número de teléfono de contacto?",
  correo: "¿A qué correo electrónico podemos enviarle la información de su reserva corporativa?",
  numero_personas: "¿Para cuántos comensales desea realizar la reserva?",
  fecha: "¿Para qué fecha desea realizar su reserva?",
  hora: "¿A qué hora desea realizar su reserva?",
  motivo: "¿Cuál es el motivo de su visita? Por ejemplo, almuerzo, cena, celebración, reunión de negocios, etc.",
  metodo_pago: "¿Realizó el adelanto mediante Yape, tarjeta o transferencia?",
  monto: "¿Qué monto desea declarar como adelanto?",
  id_pago_transaccion: "¿Podría facilitarme el número de operación de su adelanto? Quedará pendiente de verificación.",
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

const respuestaConsulta = async ( mensaje, interpretacion, sesion, historial ) => {
  const completion = await openai.chat.completions.create({
    model: MODEL,
    temperature: 0.3,
    max_tokens: 350,
    messages: [
      {
        role: "system",
        content: `${SYSTEM_PROMPT}

Usted es el asistente de El Sabor de la Casona.

TAREA: Responder la pregunta del comensal con naturalidad y elegancia.

Consulta identificada: ${interpretacion.consulta || mensaje}

Datos de reserva existentes: ${JSON.stringify(sesion.datos)}

Estado actual: ${sesion.estado}

REGLAS:
 - Responda exclusivamente la consulta del comensal.
- No genere resúmenes de reserva.
- No repita datos personales ya recopilados.
- No solicite confirmación del registro.
- No afirme que una reserva fue registrada.
- El backend administra los resúmenes,
  las autorizaciones y el registro.`,
      },
      ...historial.slice(-8),
      { role: "user", content: mensaje },
    ],
  });

  return ( completion.choices[0]?.message?.content?.trim() || "Con mucho gusto. ¿Qué otra información desea conocer?" );
};

const prepararDatosGuardar = (datos) => ({
  ...datos,
  identificador_fiscal: null,
  correo: datos.correo || null,
  monto: datos.monto > 0 ? datos.monto : null,
  metodo_pago: datos.monto > 0 ? datos.metodo_pago : null,
  id_pago_transaccion:
    datos.monto > 0 ? datos.id_pago_transaccion : null,
});

const presentarResumen = (sesion) => {
  sesion.estado = "esperando_confirmacion";
  sesion.resumenPendiente = true;
  sesion.consultaPendiente = false;
  sesion.versionConfirmada = sesion.version;

  return crearResumen(sesion.datos);
};

const confirmacionVigente = (sesion) =>
  sesion.resumenPendiente &&
  sesion.estado === "esperando_confirmacion" &&
  sesion.versionConfirmada === sesion.version;

const registrarReserva = async (sesion) => {
  const faltantes = camposFaltantes(sesion.datos);

  if (faltantes.length > 0) {
    invalidarResumen(sesion);

    return {
      contenido: preguntas[faltantes[0]],
      registrado: false,
    };
  }

  const errorValidacion = validarDatos(sesion.datos);

  if (errorValidacion) {
    invalidarResumen(sesion);

    return {
      contenido: errorValidacion,
      registrado: false,
    };
  }

  sesion.estado = "registrando";
  sesion.resumenPendiente = false;
  sesion.versionConfirmada = null;

  let resultado;

  try {
    resultado = await GuardarReserva(
      prepararDatosGuardar(sesion.datos)
    );
  } catch (error) {
    console.error("Error GuardarReserva:", {
      message: error.message,
      code: error.code,
    });

    sesion.estado = "revision_manual";

    return {
      contenido:
        "Disculpe, ocurrió un inconveniente al registrar su solicitud. No podemos asegurar si quedó guardada. Para evitar duplicados, nuestro equipo deberá revisar la situación antes de realizar otro intento.",
      registrado: false,
    };
  }

  if (!resultado?.success || !resultado?.insertId) {
    sesion.estado = "revision_manual";

    return {
      contenido:
        "No hemos podido confirmar el registro de su solicitud. Por favor, comuníquese con nuestro equipo para revisar la situación antes de volver a intentarlo.",
      registrado: false,
    };
  }

  sesion.estado = "registrada";
  sesion.reservaId = resultado.insertId;
  sesion.consultaPendiente = false;

  let contenido =
    `Muchas gracias, ${sesion.datos.nombre_cliente}. ` +
    `Su solicitud de reserva ha sido registrada con el número ${resultado.insertId}. ` +
    "Nuestro equipo se comunicará con usted para confirmar la disponibilidad de su mesa.";

  if (sesion.datos.monto > 0) {
    contenido += " También hemos registrado la referencia de su adelanto, que permanece pendiente de verificación.";
  }

  if (resultado.linkFormulario) {
    contenido += ` En el siguiente enlace puede completar la información adicional(platos, bebidas) de sus invitados: ` + `[Registro de invitados](${resultado.linkFormulario}).`;
  }

  return {
    contenido,
    registrado: true,
  };
};

export const chatController = async (req, res) => {
  const { sessionId, messages } = req.body || {};

  if ( typeof sessionId !== "string" || !/^[a-f0-9-]{36}$/i.test(sessionId) ) {
    return res.status(400).json({
      error: "Identificador de sesión inválido.",
    });
  }

  if ( !Array.isArray(messages) || messages.length === 0 || messages.length > MAX_HISTORIAL ) {
    return res.status(400).json({
      error: "Historial de conversación inválido.",
    });
  }

  const historial = messages.filter( (m) => m && ["user", "assistant"].includes(m.role) && typeof m.content === "string" && m.content.length <= 4000 );

  if (historial.length !== messages.length) {
    return res.status(400).json({
      error: "El historial contiene mensajes inválidos.",
    });
  }

  const ultimo = historial.at(-1);

  if ( !ultimo || ultimo.role !== "user" || !ultimo.content.trim() ) {
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

  if ( sesion.ultimaPeticion === peticion && sesion.ultimaRespuesta ) {
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
    if (sesion.estado === "revision_manual") {
      return enviar(
        "Su solicitud requiere una revisión de nuestro equipo antes de continuar. Para evitar registros duplicados, no realizaremos otro intento automático."
      );
    }

    if (sesion.estado === "registrada") {
      const respuesta = await respuestaConsulta( mensaje, { consulta: mensaje, }, sesion, historial.slice(0, -1) );

      return enviar( `${respuesta}\n\nSu solicitud anterior ya está registrada con el número ${sesion.reservaId}.` );
    }

    const interpretacion = await interpretarMensaje( mensaje, sesion, historial.slice(0, -1) );

    const intenciones = new Set(interpretacion.intenciones);

    const habiaResumenVigente = confirmacionVigente(sesion);

    const { actualizado, cambioPago } = actualizarDatos( sesion, interpretacion.cambios );

    // Cancelar requiere una petición inequívoca.
    if ( intenciones.has("cancelar") && !interpretacion.tiene_pregunta && !interpretacion.tiene_condicion && !interpretacion.requiere_aclaracion ) {
      sesion.datos = crearDatos();
      sesion.version++;
      invalidarResumen(sesion);

      return enviar(
        "He descartado los datos de esta solicitud. Cuando desee comenzar una nueva reserva, será un placer atenderle."
      );
    }

    // Si el comensal rechaza el adelanto, eliminar sus datos.
    if (interpretacion.desea_adelanto === false) {
      const teniaPago = sesion.datos.monto !== null || sesion.datos.metodo_pago !== null || sesion.datos.id_pago_transaccion !== null;

      if (teniaPago) {
        sesion.datos.monto = null;
        sesion.datos.metodo_pago = null;
        sesion.datos.id_pago_transaccion = null;
        sesion.version++;
        invalidarResumen(sesion);
      }
    }

    const hayConsulta = interpretacion.tiene_pregunta || intenciones.has("consultar") || Boolean(interpretacion.consulta);
    const hayCondicion = interpretacion.tiene_condicion;
    const hayAmbiguedad = interpretacion.requiere_aclaracion;

    // Las preguntas tienen prioridad sobre cualquier confirmación.
    if (hayConsulta) {
      const respuesta = await respuestaConsulta( mensaje, interpretacion, sesion, historial.slice(0, -1) );

      if (habiaResumenVigente && !actualizado && !cambioPago) {
        sesion.estado = "esperando_confirmacion";
        sesion.resumenPendiente = true;
        sesion.consultaPendiente = false;

        return enviar(
          `${respuesta}\n\nCuando haya resuelto sus dudas, podremos continuar con la confirmación de su solicitud.`
        );
      }

      const faltantes = camposFaltantes(sesion.datos);
      const errorHorario = validarHorario(sesion.datos);

      if (errorHorario) {
        return enviar(`${respuesta}\n\n${errorHorario}`);
      }

      if (faltantes.length > 0) {
        sesion.estado = "recopilando";

        return enviar(
          `${respuesta}\n\nPara continuar con su reserva, ${preguntas[faltantes[0]].charAt(0).toLowerCase()}${preguntas[faltantes[0]].slice(1)}`
        );
      }

      const error = validarDatos(sesion.datos);

      if (error) {
        return enviar(`${respuesta}\n\n${error}`);
      }

      // No presentar el resumen automáticamente mientras exista
      // una decisión pendiente sobre un posible adelanto.
      if ( interpretacion.desea_adelanto === true && !sesion.datos.monto ) {
        return enviar( `${respuesta}\n\n¿De qué monto desea realizar el adelanto?` );
      }

      return enviar( `${respuesta}\n\n${presentarResumen(sesion)}` );
    }

    // Una condición o duda bloquea el registro.
    if (hayCondicion || hayAmbiguedad) {
      if (habiaResumenVigente && !actualizado) {
        sesion.estado = "esperando_confirmacion";
        sesion.consultaPendiente = true;

        return enviar(
          "Con mucho gusto. Antes de registrar su solicitud, ¿podría aclararme qué desea consultar o modificar? Conservaremos todos los datos de su reserva."
        );
      }

      return enviar( "Con mucho gusto. ¿Podría aclararme ese detalle para continuar correctamente con su reserva?" );
    }

    // Si desea adelanto, recopilar los datos antes de confirmar.
    if ( interpretacion.desea_adelanto === true && !sesion.datos.monto ) {
      sesion.estado = "recopilando";

      return enviar( "Por supuesto, puede realizar un adelanto. ¿Qué monto desea declarar para su reserva?" );
    }

    const faltantes = camposFaltantes(sesion.datos);
    const errorHorario = validarHorario(sesion.datos);

    if (errorHorario) {
      invalidarResumen(sesion);
      return enviar(errorHorario);
    }

    if (faltantes.length > 0) {
      invalidarResumen(sesion);
      return enviar(preguntas[faltantes[0]]);
    }

    const errorValidacion = validarDatos(sesion.datos);

    if (errorValidacion) {
      invalidarResumen(sesion);
      return enviar(errorValidacion);
    }

    // La confirmación solo es válida para el resumen vigente.
    const confirmacionExplicita = esConfirmacionDirecta(mensaje) || ( interpretacion.confirmacion_definitiva === true && intenciones.has("confirmar") );

    const puedeRegistrar = habiaResumenVigente && confirmacionVigente(sesion) && !actualizado && !cambioPago && !hayConsulta && !hayCondicion && !hayAmbiguedad && confirmacionExplicita;

    if (puedeRegistrar) {
      const resultado = await registrarReserva(sesion);
      return enviar(resultado.contenido);
    }

    // Una corrección invalida cualquier autorización anterior.
    if (actualizado || cambioPago) {
      return enviar(presentarResumen(sesion));
    }

    // Si se respondió una consulta sin modificar datos,
    // se conserva el resumen, pero se exige autorización clara.
    if (confirmacionVigente(sesion)) {
      sesion.consultaPendiente = false;

      return enviar(   "¿Desea confirmar su solicitud de reserva con los datos que hemos revisado?" );
    }

    // Primera presentación o renovación del resumen.
    return enviar(presentarResumen(sesion));
  } catch (error) {
       console.error("Error chatController:", {
         name: error.name,
         message: error.message,
         status: error.status,
         code: error.code,
         type: error.type,
         request_id: error.request_id,
         cause: error.cause?.message,
         stack: error.stack,
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
