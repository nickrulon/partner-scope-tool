import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';

import uploadRouter from './routes/upload.js';
import verifyRouter from './routes/verify.js';
import signRouter from './routes/sign.js';
import submissionsRouter from './routes/submissions.js';
import { UPLOADS_DIR, OUTPUTS_DIR } from './paths.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3001;
const IS_PROD = process.env.NODE_ENV === 'production';

// CORS: in dev allow the Vite dev server; in production it's same-origin so CORS isn't needed
app.use(cors({
  origin: IS_PROD
    ? false
    : ['http://localhost:5173', 'http://localhost:5174', 'http://127.0.0.1:5173', 'http://127.0.0.1:5174'],
  credentials: true
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Static files (uploads and generated PDFs — served from persistent volume in prod)
app.use('/outputs', express.static(OUTPUTS_DIR));
app.use('/uploads', express.static(UPLOADS_DIR));

// API routes
app.use('/api/upload', uploadRouter);
app.use('/api/verify', verifyRouter);
app.use('/api/sign', signRouter);
app.use('/api/submissions', submissionsRouter);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// In production, serve the built Vite frontend for all non-API routes
if (IS_PROD) {
  const clientDist = path.join(__dirname, '..', 'client', 'dist');
  app.use(express.static(clientDist));
  app.get('*', (req, res) => {
    res.sendFile(path.join(clientDist, 'index.html'));
  });
}

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT} (${IS_PROD ? 'production' : 'development'})`);
});
