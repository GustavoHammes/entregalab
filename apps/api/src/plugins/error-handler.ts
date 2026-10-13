import type { FastifyInstance } from 'fastify';
import { ZodError } from 'zod';

import { AppError } from '../lib/errors.js';

export function registerErrorHandler(app: FastifyInstance) {
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ZodError) {
      return reply.code(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Confira os campos informados.',
          details: error.issues.map((issue) => ({
            path: issue.path.join('.'),
            message: issue.message
          }))
        }
      });
    }

    if (error instanceof AppError) {
      return reply.code(error.statusCode).send({
        error: {
          code: error.code,
          message: error.message,
          details: error.details
        }
      });
    }

    if (error && typeof error === 'object' && 'code' in error && error.code === '23505') {
      return reply.code(409).send({ error: { code: 'CONFLICT', message: 'Este registro ja existe.' } });
    }
    if (error && typeof error === 'object' && 'statusCode' in error && typeof error.statusCode === 'number' && error.statusCode < 500) {
      return reply.code(error.statusCode).send({ error: { code: 'REQUEST_ERROR', message: error.statusCode === 429 ? 'Muitas tentativas. Aguarde um minuto.' : 'Requisicao invalida.' } });
    }

    request.log.error(error);

    return reply.code(500).send({
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Nao foi possivel concluir. Tente novamente.'
      }
    });
  });
}
