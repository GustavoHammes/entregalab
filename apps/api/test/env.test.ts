import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseEnvironment } from '../src/config/schema.js';

const core = { DATABASE_URL: 'postgresql://test:test@localhost/entregalab_test', JWT_SECRET: 'test-secret-at-least-32-characters' };
const email = {
  APP_URL: 'https://example.com', EMAIL_ENABLED: 'true',
  EMAIL_ADMIN_USER_ID: '12345678-1234-4234-8234-123456789abc', EMAIL_TOKEN_KEY: 'ab'.repeat(32),
  GMAIL_CLIENT_ID: 'example.apps.googleusercontent.com', GMAIL_CLIENT_SECRET: 'private-client-secret',
  GMAIL_USER: 'sender@example.com', EMAIL_MAX_PER_DAY: '100'
};

test('email is optional and disabled by default, including empty optional fields', () => {
  const parsed = parseEnvironment({ ...core, EMAIL_ADMIN_USER_ID: '', EMAIL_TOKEN_KEY: '', GMAIL_USER: '' });
  assert.equal(parsed.env.EMAIL_ENABLED, false);
  assert.equal(parsed.env.EMAIL_ADMIN_USER_ID, undefined);
  assert.deepEqual(parsed.invalidEmailFields, []);
});

test('valid email configuration preserves the administrator and encryption key', () => {
  const parsed = parseEnvironment({ ...core, ...email });
  assert.equal(parsed.env.EMAIL_ENABLED, true);
  assert.equal(parsed.env.EMAIL_ADMIN_USER_ID, email.EMAIL_ADMIN_USER_ID);
  assert.equal(parsed.env.EMAIL_TOKEN_KEY, email.EMAIL_TOKEN_KEY);
  assert.equal(parsed.env.EMAIL_MAX_PER_DAY, 100);
  assert.deepEqual(parsed.invalidEmailFields, []);
});

test('invalid optional email configuration disables the entire integration, not the app', () => {
  for (const [key, value] of Object.entries({ EMAIL_ADMIN_USER_ID: 'user.id', EMAIL_TOKEN_KEY: 'private-invalid-key',
    EMAIL_ENABLED: 'yes', GMAIL_USER: 'not-an-email', APP_URL: 'not-a-url', EMAIL_MAX_PER_DAY: '0' })) {
    const parsed = parseEnvironment({ ...core, ...email, [key]: value });
    assert.deepEqual(parsed.invalidEmailFields, [key]);
    assert.equal(parsed.env.EMAIL_ENABLED, false);
    assert.equal(parsed.env.EMAIL_ADMIN_USER_ID, undefined);
    assert.equal(parsed.env.EMAIL_TOKEN_KEY, undefined);
    assert.equal(parsed.env.GMAIL_CLIENT_SECRET, undefined);
    assert.equal(parsed.env.DATABASE_URL, core.DATABASE_URL);
    assert.equal(parsed.env.JWT_SECRET, core.JWT_SECRET);
    assert.ok(!JSON.stringify(parsed.invalidEmailFields).includes(value));
  }
});

test('rejects invalid email settings even if delivery was already disabled', () => {
  const parsed = parseEnvironment({ ...core, ...email, EMAIL_ENABLED: 'false', EMAIL_TOKEN_KEY: 'ab'.repeat(31) });
  assert.deepEqual(parsed.invalidEmailFields, ['EMAIL_TOKEN_KEY']);
  assert.equal(parsed.env.EMAIL_ADMIN_USER_ID, undefined);
});

test('database, authentication and server settings still fail closed', () => {
  for (const invalid of [{ DATABASE_URL: '' }, { JWT_SECRET: 'short' }, { PORT: '0' }, { SECURE_COOKIES: 'yes' }]) {
    assert.throws(() => parseEnvironment({ ...core, ...invalid }));
  }
  assert.throws(() => parseEnvironment({}));
});
