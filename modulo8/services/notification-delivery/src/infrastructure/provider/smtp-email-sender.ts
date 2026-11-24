import nodemailer, { type Transporter } from 'nodemailer';

export interface SmtpConfig {
  host?: string;
  port: number;
  secure: boolean;
  user?: string;
  password?: string;
  from?: string;
}

export function smtpConfigFromEnv(env: NodeJS.ProcessEnv = process.env): SmtpConfig {
  const port = Number(env.SMTP_PORT ?? 465);
  return {
    host: env.SMTP_HOST?.trim() || undefined,
    port,
    secure: (env.SMTP_SECURE ?? String(port === 465)) === 'true',
    user: env.SMTP_USER?.trim() || undefined,
    // Las contraseñas de aplicación de Gmail se muestran con espacios: se quitan.
    password: env.SMTP_PASSWORD?.replace(/\s+/g, '') || undefined,
    from: env.MAIL_FROM?.trim() || env.SMTP_USER?.trim() || undefined,
  };
}

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export interface EmailSender {
  isConfigured(): boolean;
  send(message: EmailMessage): Promise<{ messageId: string }>;
}

/** Envío real de correo por SMTP (en el stack común, Gmail con contraseña de aplicación). */
export class SmtpEmailSender implements EmailSender {
  private readonly transporter?: Transporter;

  constructor(private readonly config: SmtpConfig = smtpConfigFromEnv()) {
    if (this.isConfigured()) {
      this.transporter = nodemailer.createTransport({
        host: config.host,
        port: config.port,
        secure: config.secure,
        auth: { user: config.user, pass: config.password },
        connectionTimeout: 10_000,
        greetingTimeout: 10_000,
        socketTimeout: 15_000,
      });
    }
  }

  isConfigured(): boolean {
    return Boolean(this.config.host && this.config.user && this.config.password && this.config.from);
  }

  async send(message: EmailMessage): Promise<{ messageId: string }> {
    if (!this.transporter) {
      throw new Error('SMTP sin configurar: faltan SMTP_HOST, SMTP_USER, SMTP_PASSWORD o MAIL_FROM.');
    }
    const info = await this.transporter.sendMail({ from: this.config.from, ...message });
    return { messageId: info.messageId };
  }
}
