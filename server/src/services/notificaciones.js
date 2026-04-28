import nodemailer from 'nodemailer';
import twilio from 'twilio';
import dotenv from 'dotenv';
dotenv.config();

console.log(process.env.EMAIL_USER)
const transporter = nodemailer.createTransport({
    service: process.env.EMAIL_SERVICE || 'gmail',
    port: 465,
    secure: true,
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
    },
    tls: {
    rejectUnauthorized: false
  }
});

const twilioClient = twilio(process.env.TWILIO_SID, process.env.TWILIO_AUTH_TOKEN);

export const enviarConfirmacion = async (email, whatsapp, msg) => {
  try {
    // Enviar Email
    if (email) {
      await transporter.sendMail({
        from: '"Limeñita Reservas" <reservas@limenita.pe>', // Gmail suele reescribir esto por tu EMAIL_USER, pero es buena práctica dejarlo.
        to: email,
        subject: "Confirmación de Reserva - Limeñita",
        text: msg
      });
      console.log(`Email enviado a ${email}`);
    }
  } catch (error) {
    console.error(`Error enviando email a ${email}:`, error);
  }

  try {
    // Enviar WhatsApp mediante Twilio
    if (whatsapp) {
      // Limpiamos espacios o guiones. Si el turista ingresa su código con '+', lo respetamos. Si no, por defecto es +51 (Perú).
      const numeroLimpio = whatsapp.replace(/[^\d+]/g, '');
      const numeroFormateado = numeroLimpio.startsWith('+') ? numeroLimpio : `+51${numeroLimpio}`;
      
      await twilioClient.messages.create({
        body: msg,
        from: process.env.TWILIO_WHATSAPP_FROM, // Ej: 'whatsapp:+14155238886'
        to: `whatsapp:${numeroFormateado}`
      });
      console.log(`Notificación de WhatsApp enviada a ${numeroFormateado}`);
    }
  } catch (error) {
    console.error(`Error enviando WhatsApp a ${whatsapp}:`, error);
  }
};