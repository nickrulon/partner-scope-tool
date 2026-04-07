import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// In production (Railway), DATA_DIR points to the persistent volume (e.g. /data).
// In development, it falls back to the server/ directory so existing local files work.
export const DATA_DIR    = process.env.DATA_DIR || __dirname;
export const DB_PATH     = path.join(DATA_DIR, 'scope-tool.db');
export const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
export const OUTPUTS_DIR = path.join(DATA_DIR, 'outputs');

// Ensure directories exist on startup
for (const dir of [UPLOADS_DIR, OUTPUTS_DIR]) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}
