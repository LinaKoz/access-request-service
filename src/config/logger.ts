import pino from 'pino';
import { config } from './index';

export const logger = pino({
  level: config.isTest ? 'silent' : 'info',
  transport: config.isDev
    ? { target: 'pino-pretty', options: { colorize: true } }
    : undefined,
});
