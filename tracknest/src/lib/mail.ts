import nodemailer, { type Transporter } from "nodemailer";

export type Mail = { to: string; subject: string; text: string; attachments?: { filename: string; content: string }[] };

const globalForMail = globalThis as unknown as { mailer?: Transporter };

/**
 * Sends a plain-text email through SMTP_URL (any provider: SES, Brevo, Zoho…).
 * Without SMTP_URL (local dev) the email is printed to the server log instead.
 */
export async function sendMail(mail: Mail) {
  if (!process.env.SMTP_URL) {
    const files = mail.attachments?.map((a) => `\n[attached: ${a.filename}, ${a.content.length} chars]`).join("") ?? "";
    console.info(`[mail:dev] To: ${mail.to}\nSubject: ${mail.subject}\n\n${mail.text}${files}\n[/mail:dev]`);
    return;
  }
  globalForMail.mailer ??= nodemailer.createTransport(process.env.SMTP_URL);
  await globalForMail.mailer.sendMail({ from: process.env.MAIL_FROM ?? "TrackNest <alerts@localhost>", ...mail });
}
