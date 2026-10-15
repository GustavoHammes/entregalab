import { OAuth2Client } from 'google-auth-library';
import MailComposer from 'nodemailer/lib/mail-composer/index.js';
import { z } from 'zod';
import { env } from '../../config/env.js';

export const gmailScope = 'https://www.googleapis.com/auth/gmail.send';
export function appUrl() {
  const value = env.APP_URL ?? process.env.RENDER_EXTERNAL_URL;
  if (!value) throw new Error('APP_URL is missing');
  const url = new URL(value);
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error('Invalid APP_URL');
  if (env.NODE_ENV === 'production' && url.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) throw new Error('APP_URL must use HTTPS');
  return url.origin;
}
export function gmailConfigured() {
  if (!(env.GMAIL_CLIENT_ID && env.GMAIL_CLIENT_SECRET && env.EMAIL_TOKEN_KEY && env.EMAIL_ADMIN_USER_ID)) return false;
  try { appUrl(); return true; } catch { return false; }
}
export function gmailClient() {
  return new OAuth2Client({ clientId: env.GMAIL_CLIENT_ID, clientSecret: env.GMAIL_CLIENT_SECRET,
    redirectUri: `${appUrl()}/api/email/gmail/callback`, transporterOptions: { timeout: 15000, retry: false, retryConfig: { retry: 0 } } });
}
export type EmailMessage = { id: string; to: string; subject: string; text: string };
export async function composeMessage(sender: string, message: EmailMessage) {
  z.string().email().parse(sender); z.string().email().parse(message.to);
  const mail = new MailComposer({ from: { name: 'EntregaLab', address: sender }, to: message.to,
    subject: message.subject, text: message.text, messageId: `<${message.id}@${new URL(appUrl()).hostname}>` });
  const raw = await mail.compile().build();
  return raw.toString('base64url');
}
export function gmailSender(sender: string, refreshToken: string) {
  const client = gmailClient(); client.setCredentials({ refresh_token: refreshToken });
  return async (message: EmailMessage) => {
    const raw = await composeMessage(sender, message);
    const result = await client.request<{ id: string }>({ url: 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send',
      method: 'POST', data: { raw }, timeout: 15000, retry: false });
    return z.object({ id: z.string().min(1) }).parse(result.data).id;
  };
}
export function emailErrorCode(error: unknown) {
  const value = error as { response?: { status?: number; data?: { error?: string | { errors?: { reason?: string }[] } } } };
  const data = value?.response?.data?.error;
  if (data === 'invalid_grant' || data === 'invalid_client' || value?.response?.status === 401) return 'GMAIL_REAUTH_REQUIRED';
  if (value?.response?.status === 429 || (typeof data === 'object' && data?.errors?.some((item) => /Limit|quota/i.test(item.reason ?? '')))) return 'GMAIL_RATE_LIMIT';
  return 'EMAIL_PROVIDER_ERROR';
}
