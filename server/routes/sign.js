import express from 'express';
import path from 'path';
import db from '../db.js';
import { OUTPUTS_DIR } from '../paths.js';
import { generateScopeVerificationPDF } from '../services/pdfGenerate.js';

const router = express.Router();

router.post('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { ack_cgi, ack_timeline, ack_ticketing, ack_scope, ack_responsibilities, partner_signature } = req.body;

    // Validate all acks
    if (!ack_cgi || !ack_timeline || !ack_ticketing || !ack_scope || !ack_responsibilities) {
      return res.status(400).json({ error: 'All acknowledgments must be accepted' });
    }

    if (!partner_signature || partner_signature.trim() === '') {
      return res.status(400).json({ error: 'Partner signature is required' });
    }

    const ip = req.ip || req.connection?.remoteAddress || '0.0.0.0';
    const now = new Date().toISOString();

    // Update submission
    const updateStmt = db.prepare(`
      UPDATE submissions
      SET
        ack_cgi = ?,
        ack_timeline = ?,
        ack_ticketing = ?,
        ack_scope = ?,
        ack_responsibilities = ?,
        partner_signature = ?,
        signature_timestamp = ?,
        signature_ip = ?,
        status = 'signed'
      WHERE id = ?
    `);

    updateStmt.run(
      ack_cgi ? 1 : 0,
      ack_timeline ? 1 : 0,
      ack_ticketing ? 1 : 0,
      ack_scope ? 1 : 0,
      ack_responsibilities ? 1 : 0,
      partner_signature.trim(),
      now,
      ip,
      id
    );

    // Fetch full submission
    const submission = db.prepare('SELECT * FROM submissions WHERE id = ?').get(id);

    if (!submission) {
      return res.status(404).json({ error: 'Submission not found' });
    }

    // Generate PDF
    const outputPath = path.join(OUTPUTS_DIR, `${id}.pdf`);

    await generateScopeVerificationPDF(submission, outputPath);

    // Update output path and submitted_at
    db.prepare(`
      UPDATE submissions
      SET output_pdf_path = ?, submitted_at = ?
      WHERE id = ?
    `).run(outputPath, now, id);

    return res.json({
      success: true,
      pdf_url: `/outputs/${id}.pdf`
    });
  } catch (err) {
    console.error('Sign error:', err);
    return res.status(500).json({ error: err.message || 'Signing failed' });
  }
});

export default router;
