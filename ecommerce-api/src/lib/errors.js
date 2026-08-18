// One error type for everything the API deliberately rejects.
//
// Throwing these from a service is what lets controllers stay free of status
// codes: the service says "this conflicts", the error handler decides that
// means 409. Anything thrown that is NOT an ApiError is a bug, and the error
// handler treats it as a 500 without leaking its message.

export class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    if (details) this.details = details;
  }
}

// The request could not be read: unparseable JSON, a malformed query value.
export const badRequest = (message, details) =>
  new ApiError(400, 'BAD_REQUEST', message, details);

// No credentials, or credentials that do not check out. Deliberately vague:
// telling a caller *which* half of an email/password pair was wrong hands an
// attacker a way to enumerate registered accounts.
export const unauthenticated = (message = 'Authentication is required.') =>
  new ApiError(401, 'UNAUTHENTICATED', message);

// Authenticated, but not allowed to do this.
export const forbidden = (message = 'You do not have access to this resource.') =>
  new ApiError(403, 'FORBIDDEN', message);

// No such resource — or one this caller is not entitled to know exists. Using
// 404 rather than 403 for someone else's private resource is intentional: a
// 403 confirms the id is real, which is itself a leak.
export const notFound = (message = 'Resource not found.') =>
  new ApiError(404, 'NOT_FOUND', message);

// The request is valid but conflicts with the current state of things.
export const conflict = (message, code = 'CONFLICT') =>
  new ApiError(409, code, message);

// The request was read fine; its contents are wrong. `details` lists every
// offending field at once, so a form can show all its errors in one pass.
export const validationFailed = (details, message = 'The request is invalid.') =>
  new ApiError(422, 'VALIDATION_ERROR', message, details);
