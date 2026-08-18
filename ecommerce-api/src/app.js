import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { apiRouter } from './routes/index.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { config } from './config/index.js';

// Builds the app without starting it, so tests can drive it in-process.
export function createApp() {
  const app = express();

  // Behind a load balancer, req.ip is the balancer without this, which would
  // make the rate limiter count every user as the same client.
  app.set('trust proxy', 1);

  app.disable('x-powered-by');
  app.use(helmet());

  app.use(
    cors({
      // An explicit allow-list. Reflecting the request's Origin instead would
      // let any site call the API with a user's credentials.
      origin: config.corsOrigins.length > 0 ? config.corsOrigins : false,
      // The guest cart token is sent as a custom header, so the browser needs
      // permission to send it, and to read it back on the responses that mint one.
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Cart-Session'],
      exposedHeaders: ['X-Cart-Session'],
    }),
  );

  // A body limit, because the default is 100kb of JSON parsed before any of our
  // code runs, and there is no endpoint here that needs even that.
  app.use(express.json({ limit: '32kb' }));

  app.use('/api', apiRouter);

  // Order matters: unmatched routes become a 404 error, and the error handler
  // is last so every failure above it lands in one place.
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
