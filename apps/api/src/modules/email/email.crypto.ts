import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from 'node:crypto';
import { env } from '../../config/env.js';

export function digest(value: string) { return createHash('sha256').update(value).digest('hex'); }
export function verificationToken(id: string) {
  return `${id}.${createHmac('sha256', env.JWT_SECRET).update(`email-verification:${id}`).digest('base64url')}`;
}
export function seal(value: string) {
  if (!env.EMAIL_TOKEN_KEY) throw new Error('Email encryption key is missing');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', Buffer.from(env.EMAIL_TOKEN_KEY, 'hex'), iv);
  cipher.setAAD(Buffer.from('entregalab-email-v1'));
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64url');
}
export function unseal(value: string) {
  if (!env.EMAIL_TOKEN_KEY) throw new Error('Email encryption key is missing');
  const data = Buffer.from(value, 'base64url');
  const cipher = createDecipheriv('aes-256-gcm', Buffer.from(env.EMAIL_TOKEN_KEY, 'hex'), data.subarray(0, 12));
  cipher.setAAD(Buffer.from('entregalab-email-v1')); cipher.setAuthTag(data.subarray(12, 28));
  return Buffer.concat([cipher.update(data.subarray(28)), cipher.final()]).toString('utf8');
}
