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
import { createTodosRouter } from './routes/todos.js';
import { createSearchRouter } from './routes/search.js';
import { createDocumensoRouter } from './routes/documenso.js';
import { createMv104Router } from './routes/mv104.js';
import { createMv104FormsRouter } from './routes/mv104Forms.js';
import { createReceiptsRouter } from './routes/receipts.js';
import { createNotesRouter } from './routes/notes.js';
import { createRentalsRouter } from './routes/rentals.js';
import { protectMutations } from './auth.js';
import { errorHandler } from './errors.js';
import { ensureDefaultAdmin } from './seed.js';

const app = express();
const prisma = new PrismaClient();
const port = Number(process.env.PORT || 4000);

// Production traffic arrives through Caddy, so trust one proxy hop for the real client IP (login throttling).
app.set('trust proxy', 1);
app.disable('x-powered-by');

// Only the listed browser origins may call the API cross-origin. Production is same-origin through Caddy.
const allowedOrigins = (process.env.CORS_ORIGINS || (process.env.NODE_ENV === 'production' ? '' : 'http://localhost:5173,http://127.0.0.1:5173'))
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);
app.use(cors({ origin: (origin, callback) => callback(null, !origin || allowedOrigins.includes(origin)) }));
app.use(express.json());
app.use(morgan('dev'));
app.use('/api/auth', createAuthRouter(prisma));
app.use('/api', protectMutations(prisma));
app.use('/api', createDocumensoRouter(prisma));
app.use('/api/customers', createCustomersRouter(prisma));
app.use('/api', createWorkflowsRouter(prisma));
app.use('/api', createOperationsRouter(prisma));
app.use('/api', createMv104Router(prisma));
app.use('/api', createMv104FormsRouter(prisma));
app.use('/api/finance', createFinanceRouter(prisma));
app.use('/api/invoices', createInvoicesRouter(prisma));
app.use('/api/search', createSearchRouter(prisma));
app.use('/api/todos', createTodosRouter(prisma));
app.use('/api', createReceiptsRouter(prisma));
app.use('/api', createNotesRouter(prisma));
app.use('/api', createRentalsRouter(prisma));

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
