import { randomBytes } from 'node:crypto';
import { writeFile } from 'node:fs/promises';

const target = new URL('../.env.production', import.meta.url);
const contents = `POSTGRES_PASSWORD=${randomBytes(24).toString('hex')}\nJWT_SECRET=${randomBytes(48).toString('hex')}\nAPP_PORT=8080\nAPP_BIND=127.0.0.1\nAPP_ORIGIN=http://localhost:8080\nSECURE_COOKIES=false\nTRUST_PROXY=false\n`;
try {
  await writeFile(target, contents, { flag: 'wx', mode: 0o600 });
  console.log('.env.production criado com segredos aleatorios.');
} catch (error) {
  if (error.code !== 'EEXIST') throw error;
  console.log('.env.production ja existe e foi preservado.');
}
