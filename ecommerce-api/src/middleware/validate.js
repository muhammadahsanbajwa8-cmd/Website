import { validationFailed } from '../lib/errors.js';

// Flattens a ZodError into the flat {field, message} list the API promises.
export function zodDetails(error) {
  return error.issues.map((issue) => ({
    field: issue.path.join('.') || '(root)',
    message: issue.message,
  }));
}

// Validates the named parts of a request and REPLACES them with the parsed
// result, so handlers downstream see coerced, stripped, trusted data.
//
// Replacing rather than merely checking is the important part: it means a
// handler physically cannot read an unvalidated field, because zod's default
// behaviour strips keys the schema does not mention. An `isAdmin: true` smuggled
// into a registration body is gone before any code could act on it.
export function validate(schemas) {
  return function validateRequest(req, _res, next) {
    const details = [];

    for (const part of ['body', 'params', 'query']) {
      const schema = schemas[part];
      if (!schema) continue;

      const result = schema.safeParse(req[part]);
      if (result.success) {
        // req.query has only a getter in Express 5; defineProperty works on both.
        Object.defineProperty(req, part, {
          value: result.data,
          writable: true,
          configurable: true,
        });
      } else {
        details.push(...zodDetails(result.error));
      }
    }

    // Report every bad field at once rather than one per round trip.
    if (details.length > 0) return next(validationFailed(details));
    next();
  };
}
