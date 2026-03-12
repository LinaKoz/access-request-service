import express from 'express';
import swaggerUi from 'swagger-ui-express';
import { requestLogger } from './middleware/requestLogger';
import { errorHandler } from './middleware/errorHandler';
import { authRoutes } from './modules/auth/auth.routes';
import { requestRoutes } from './modules/requests/request.routes';
import { agentRoutes } from './agent/agent.routes';
import { yoga } from './graphql/schema';
import { openApiSpec } from './openapi';

const app = express();

app.use(express.json());
app.use(requestLogger);

app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(openApiSpec));

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.use('/api/auth', authRoutes);
app.use('/api/requests', requestRoutes);
app.use('/api/agent', agentRoutes);

app.use(yoga.graphqlEndpoint, yoga);

app.use(errorHandler);

export { app };
