import { app } from './app';
import { config } from './config';
import { logger } from './config/logger';

const server = app.listen(config.port, () => {
  logger.info({ port: config.port, env: config.nodeEnv }, 'Server started');
});

function shutdown(signal: string) {
  logger.info({ signal }, 'Shutdown signal received, closing server');
  server.close(() => {
    process.exit(0);
  });
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
