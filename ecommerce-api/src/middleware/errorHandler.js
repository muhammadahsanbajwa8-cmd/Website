import { Prisma } from '@prisma/client';
import { ApiError } from '../lib/errors.js';
import { config } from '../config/index.js';

// The single exit for every failure. Nothing else in the codebase writes an
// error response, which is what makes the error shape genuinely consistent
// rather than consistent-where-someone-remembered.

export function notFoundHandler(req, _res, next) {
  next(
    new ApiError(404, 'NOT_FOUND', `No route matches ${req.method} ${req.path}.`),
  );
}

export function errorHandler(error, req, res, _next) {
  let status = 500;
  let code = 'INTERNAL_ERROR';
  let message = 'Something went wrong.';
  let details;

  if (error instanceof ApiError) {
    ({ status, code, message, details } = error);
  } else if (error instanceof SyntaxError && 'body' in error) {
    // express.json() throws this for a malformed body. 400, not 422: we could
    // not read the request at all, so there are no fields to complain about.
    status = 400;
    code = 'BAD_REQUEST';
    message = 'The request body is not valid JSON.';
  } else if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === 'P2002') {
      status = 409;
      code = 'CONFLICT';
      message = 'A record with that value already exists.';
    } else if (error.code === 'P2025') {
      status = 404;
      code = 'NOT_FOUND';
      message = 'Resource not found.';
    }
  }

  // A 500 is a bug in our code, so it goes to the log in full. The client gets
  // the generic message above: a stack trace or a raw database error tells an
  // attacker about our schema and file layout, and tells a legitimate user
  // nothing they can act on.
  if (status >= 500) {
    console.error(`[${req.method} ${req.path}]`, error);
  }

  const body = { error: { code, message } };
  if (details) body.error.details = details;
  // Only outside production, and only for 500s, echo the real message back —
  // it makes local debugging bearable without ever shipping.
  if (status >= 500 && !config.isProduction) {
    body.error.debug = error.message;
  }

  res.status(status).json(body);
}
