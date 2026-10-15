import express from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import morgan from 'morgan';
import { config } from './config.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { requireJsonBody } from './middleware/auth.js';
import healthRouter from './routes/health.js';
import authRouter from './routes/auth.js';
import usersRouter from './routes/users.js';
import departmentsRouter from './routes/departments.js';
import assetsRouter from './routes/assets.js';
import assignmentsRouter from './routes/assignments.js';
import meRouter from './routes/me.js';
import auditLogsRouter from './routes/auditLogs.js';
import dashboardRouter from './routes/dashboard.js';
import alertsRouter from './routes/alerts.js';
import maintenanceRouter, { assetMaintenanceRouter } from './routes/maintenance.js';
import reportsRouter from './routes/reports.js';
import setupRouter from './routes/setup.js';
import passwordResetRouter from './routes/passwordReset.js';

export function createApp() {
  const app = express();

  // nginx arkasında çalışırken gerçek istemci IP'si (rate limit için) X-Forwarded-For'dan alınır.
  // Yalnızca güvenilen (varsayılan: yerel/özel ağdaki) vekillerin başlığına inanılır; bkz. TRUST_PROXY.
  app.set('trust proxy', config.trustProxy);
  app.disable('x-powered-by');

  app.use(helmet());
  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());

  // İstek logu: yalnızca metot, yol, durum ve süre. Gövde, Cookie ve Authorization asla loglanmaz.
  if (!config.isTest) {
    app.use(morgan(':method :url :status :response-time ms'));
  }

  app.use('/health', healthRouter);

  app.use('/api', requireJsonBody);
  app.use('/api/setup', setupRouter);
  app.use('/api/auth', authRouter);
  app.use('/api/password-reset-requests', passwordResetRouter);
  app.use('/api/users', usersRouter);
  app.use('/api/departments', departmentsRouter);
  app.use('/api/assets', assetsRouter);
  app.use('/api/assets', assetMaintenanceRouter);
  app.use('/api/assignments', assignmentsRouter);
  app.use('/api/me', meRouter);
  app.use('/api/audit-logs', auditLogsRouter);
  app.use('/api/dashboard', dashboardRouter);
  app.use('/api/alerts', alertsRouter);
  app.use('/api/maintenance', maintenanceRouter);
  app.use('/api/reports', reportsRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
