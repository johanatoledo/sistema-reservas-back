
import axios from 'axios';

export const consultarRuc = async (ruc) => {
  try {
    const res = await axios.get(`${process.env.APIS_PERU_URL_RUC}${ruc}`, {
      headers: { 'Authorization': `Bearer ${process.env.APIS_PERU_TOKEN}` }
    });

    // Mantenemos el log para tu futura integración con la DB
    console.log("OBJETO CRUDO DE LA API (RUC):", JSON.stringify(res.data, null, 2));

    // 1. Validamos que la respuesta de la API sea exitosa y contenga 'data'
    if (res.data.success && res.data.data) {
      const d = res.data.data;

      // 2. Las validaciones de SUNAT deben ser sobre los datos dentro de 'd'
      // Nota: Verifica en tu log si es d.estado o d.estado_del_contribuyente
      if (d.estado === 'ACTIVO' && d.condicion === 'HABIDO') {
        return { 
          success: true, 
          razonSocial: d.nombre_o_razon_social, 
          direccion: d.direccion || "Dirección no registrada",
          ruc: d.ruc,
          estado: d.estado,
          condicion: d.condicion
        };
      } else {
        // Caso: RUC existe pero no es apto (ej. está de baja)
        return { 
          success: false, 
          message: `La empresa se encuentra en estado ${d.estado} y condición ${d.condicion}. No puede realizar trámites.` 
        };
      }
    }
    
    // 3. Caso: La API responde success: false (RUC no existe)
    return { success: false, message: "El número de RUC no fue encontrado en el sistema." };

  } catch (error) {
    // Log de error técnico para ti
    console.error("Error técnico en consultarRuc:", error.message);
    
    return { 
      success: false, 
      message: "Hubo un problema de conexión con SUNAT. Por favor, intente más tarde." 
    };
  }
};
export const consultarDni = async (dni) => {
  try {
    const res = await axios.get(`${process.env.APIS_PERU_URL_DNI}${dni}`, {
      headers: { 'Authorization': `Bearer ${process.env.APIS_PERU_TOKEN}` }
    });
    // ESTO ES LO MÁS IMPORTANTE:
    console.log("OBJETO CRUDO DE LA API:", JSON.stringify(res.data, null, 2));
    
    // Si la API devuelve success: true y el objeto data existe
    if (res.data.success && res.data.data) {
      const d = res.data.data;
      return { 
       success: true, 
        nombres: d.nombres, 
        apellidos: `${d.apellido_paterno} ${d.apellido_materno}`,
        nombreCompleto: d.nombre_completo // Opcional, por si la IA lo prefiere
      };
    }
    return { success: false, message: "No pudimos encontrar ese número de DNI." };
  } catch (error) {
    return { success: false, message: "Error al consultar RENIEC." };
  }
};
