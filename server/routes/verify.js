import express from 'express';
import db from '../db.js';

const router = express.Router();

router.post('/:id', (req, res) => {
  try {
    const { id } = req.params;
    const { confirmed_fields } = req.body;

    if (!confirmed_fields || !Array.isArray(confirmed_fields)) {
      return res.status(400).json({ error: 'confirmed_fields must be an array' });
    }

    const stmt = db.prepare(`
      UPDATE submissions
      SET confirmed_fields = ?, status = 'confirmed'
      WHERE id = ?
    `);

    const result = stmt.run(JSON.stringify(confirmed_fields), id);

    if (result.changes === 0) {
      return res.status(404).json({ error: 'Submission not found' });
    }

    return res.json({ success: true });
  } catch (err) {
    console.error('Verify error:', err);
    return res.status(500).json({ error: err.message || 'Verification failed' });
  }
});

export default router;
