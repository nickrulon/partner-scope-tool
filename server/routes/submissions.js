import express from 'express';
import db from '../db.js';

const router = express.Router();

// GET all submissions (PAM-protected)
router.get('/', (req, res) => {
  try {
    const pamPassword = process.env.PAM_PASSWORD || 'commercient2026';

    // Check password via query param or Authorization header
    const queryPassword = req.query.password;
    const authHeader = req.headers.authorization;
    let providedPassword = null;

    if (queryPassword) {
      providedPassword = queryPassword;
    } else if (authHeader && authHeader.startsWith('Bearer ')) {
      providedPassword = authHeader.slice(7);
    }

    if (providedPassword !== pamPassword) {
      return res.status(401).json({ error: 'Invalid password' });
    }

    const submissions = db.prepare(`
      SELECT * FROM submissions ORDER BY created_at DESC
    `).all();

    return res.json(submissions);
  } catch (err) {
    console.error('Submissions list error:', err);
    return res.status(500).json({ error: err.message || 'Failed to fetch submissions' });
  }
});

// GET single submission (no auth - used by frontend)
router.get('/:id', (req, res) => {
  try {
    const { id } = req.params;
    const submission = db.prepare('SELECT * FROM submissions WHERE id = ?').get(id);

    if (!submission) {
      return res.status(404).json({ error: 'Submission not found' });
    }

    return res.json(submission);
  } catch (err) {
    console.error('Submission get error:', err);
    return res.status(500).json({ error: err.message || 'Failed to fetch submission' });
  }
});

export default router;
