import nodemailer, { type Transporter } from 'nodemailer';

const SMTP_CONNECTION_TIMEOUT_MS = 10_000;
const SMTP_GREETING_TIMEOUT_MS = 10_000;
const SMTP_SOCKET_TIMEOUT_MS = 20_000;

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

/** Gửi email (out-app). Dev đi qua Mailpit (smtp://localhost:1025); thật dùng SMTP của SES. */
export interface Mailer {
  send(message: EmailMessage): Promise<void>;
}

export class SmtpMailer implements Mailer {
  private readonly transporter: Transporter;

  constructor(
    smtpUrl: string,
    private readonly from: string,
  ) {
    this.transporter = nodemailer.createTransport({
      url: smtpUrl,
      connectionTimeout: SMTP_CONNECTION_TIMEOUT_MS,
      greetingTimeout: SMTP_GREETING_TIMEOUT_MS,
      socketTimeout: SMTP_SOCKET_TIMEOUT_MS,
    });
  }

  async send(message: EmailMessage): Promise<void> {
    await this.transporter.sendMail({ from: this.from, ...message });
  }
}

/** Bản bộ nhớ cho test: giữ lại email đã gửi. */
export class MemoryMailer implements Mailer {
  readonly sent: EmailMessage[] = [];

  async send(message: EmailMessage): Promise<void> {
    this.sent.push(message);
  }
}
