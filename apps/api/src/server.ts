import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import { PrismaClient } from '@prisma/client';
import { createCustomersRouter } from './routes/customers.js';
import { createWorkflowsRouter } from './routes/workflows.js';
import { createAuthRouter } from './routes/auth.js';
import { createOperationsRouter } from './routes/operations.js';
import { createFinanceRouter } from './routes/finance.js';
import { createInvoicesRouter } from './routes/invoices.js';
import { protectMutations } from './auth.js';
import { errorHandler } from './errors.js';
import { ensureDefaultAdmin } from './seed.js';

const app = express();
const prisma = new PrismaClient();
const port = Number(process.env.PORT || 4000);

app.use(cors());
app.use(express.json());
app.use(morgan('dev'));
app.use('/api/auth', createAuthRouter(prisma));
app.use('/api', protectMutations(prisma));
app.use('/api/customers', createCustomersRouter(prisma));
app.use('/api', createWorkflowsRouter(prisma));
app.use('/api', createOperationsRouter(prisma));
app.use('/api/finance', createFinanceRouter(prisma));
app.use('/api/invoices', createInvoicesRouter(prisma));

app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'collision-shop-api',
    timestamp: new Date().toISOString(),
  });
});

app.get('/api', (_req, res) => {
  res.json({
    message: 'Collision shop API ready',
    routes: ['/api/health', '/api/auth/session', '/api/auth/organizations', '/api/customers', '/api/dashboard', '/api/vehicles', '/api/claims', '/api/jobs', '/api/estimates', '/api/documents', '/api/reports'],
  });
});

app.use(errorHandler);

const server = app.listen(port, () => {
  void ensureDefaultAdmin(prisma).then(() => console.log(`API running on http://localhost:${port}`)).catch((error) => console.error('Default admin setup failed', error));
});

async function shutdown(signal: string) {
  console.log(`Received ${signal}, shutting down`);
  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
}

process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));
