import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';

import { z } from 'zod';
import { parseEnvironment } from './schema.js';

dotenv.config({ path: fileURLToPath(new URL('../../../../.env', import.meta.url)) });

function loadEnvironment() {
  try {
    return parseEnvironment(process.env);
  } catch (error) {
    if (!(error instanceof z.ZodError)) throw error;
    console.error('Invalid environment variables', error.flatten().fieldErrors);
    throw new Error('Invalid environment variables');
  }
}

const configuration = loadEnvironment();
if (configuration.invalidEmailFields.length) {
  console.warn('Email disabled: invalid optional environment variables. Check Environment in Render:', configuration.invalidEmailFields);
}

export const env = configuration.env;
