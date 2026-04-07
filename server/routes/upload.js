import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import db from '../db.js';
import { extractPdfText } from '../services/pdfExtract.js';
import { extractFields } from '../services/aiExtract.js';

const router = express.Router();

import { UPLOADS_DIR } from '../paths.js';

const uploadsDir = UPLOADS_DIR;

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    cb(null, `${Date.now()}_${safeName}`);
  }
});

const fileFilter = (req, file, cb) => {
  if (file.mimetype === 'application/pdf' || file.originalname.toLowerCase().endsWith('.pdf')) {
    cb(null, true);
  } else {
    cb(new Error('Only PDF files are allowed'), false);
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB
});

router.post('/', upload.single('contract'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No PDF file uploaded' });
    }

    const {
      customer_name,
      partner_company,
      partner_name,
      partner_email,
      pam_name,
      deal_id
    } = req.body;

    if (!customer_name || !partner_company || !partner_name || !partner_email || !pam_name) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const contractPath = req.file.path;
    const contractFilename = req.file.filename;

    // Extract PDF text
    let pdfText = '';
    try {
      pdfText = await extractPdfText(contractPath);
    } catch (err) {
      console.error('PDF text extraction failed:', err);
      pdfText = '';
    }

    // Extract fields with AI
    let extractedFields = [];
    if (pdfText && pdfText.trim().length > 50) {
      try {
        extractedFields = await extractFields(pdfText);
      } catch (err) {
        console.error('AI extraction failed:', err);
        // Return empty fields with not_found: true for all
        const fieldDefs = [
          { field: 'customer_name', label: 'Customer Name' },
          { field: 'customer_contact', label: 'Customer Contact' },
          { field: 'customer_email', label: 'Customer Email' },
          { field: 'erp_system', label: 'ERP System' },
          { field: 'crm_system', label: 'CRM System' },
          { field: 'tables_included', label: 'Tables / Objects Included' },
          { field: 'sync_direction', label: 'Sync Direction' },
          { field: 'sync_frequency', label: 'Sync Frequency' },
          { field: 'phase_included', label: 'Phase Included' },
          { field: 'monthly_saas_fee', label: 'Monthly SaaS Fee' },
          { field: 'success_plan_fee', label: 'Success Plan Fee' },
          { field: 'contract_term', label: 'Contract Term' },
          { field: 'trial_period', label: 'Trial Period' },
          { field: 'partner_company', label: 'Partner Company' },
          { field: 'customer_responsibilities', label: 'Customer Responsibilities' },
          { field: 'notable_exclusions', label: 'Notable Exclusions' },
          { field: 'special_conditions', label: 'Special Conditions' }
        ];
        extractedFields = fieldDefs.map(f => ({
          ...f,
          value: '',
          source_text: '',
          page_num: null,
          confidence: 'low',
          not_found: true
        }));
      }
    } else {
      // PDF text couldn't be extracted
      const fieldDefs = [
        { field: 'customer_name', label: 'Customer Name' },
        { field: 'customer_contact', label: 'Customer Contact' },
        { field: 'customer_email', label: 'Customer Email' },
        { field: 'erp_system', label: 'ERP System' },
        { field: 'crm_system', label: 'CRM System' },
        { field: 'tables_included', label: 'Tables / Objects Included' },
        { field: 'sync_direction', label: 'Sync Direction' },
        { field: 'sync_frequency', label: 'Sync Frequency' },
        { field: 'phase_included', label: 'Phase Included' },
        { field: 'monthly_saas_fee', label: 'Monthly SaaS Fee' },
        { field: 'success_plan_fee', label: 'Success Plan Fee' },
        { field: 'contract_term', label: 'Contract Term' },
        { field: 'trial_period', label: 'Trial Period' },
        { field: 'partner_company', label: 'Partner Company' },
        { field: 'customer_responsibilities', label: 'Customer Responsibilities' },
        { field: 'notable_exclusions', label: 'Notable Exclusions' },
        { field: 'special_conditions', label: 'Special Conditions' }
      ];
      extractedFields = fieldDefs.map(f => ({
        ...f,
        value: '',
        source_text: '',
        page_num: null,
        confidence: 'low',
        not_found: true
      }));
    }

    // Insert into DB
    const stmt = db.prepare(`
      INSERT INTO submissions (
        customer_name, partner_company, partner_name, partner_email,
        pam_name, deal_id, contract_filename, contract_path,
        extracted_fields, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft')
    `);

    const result = stmt.run(
      customer_name,
      partner_company,
      partner_name,
      partner_email,
      pam_name,
      deal_id || null,
      contractFilename,
      contractPath,
      JSON.stringify(extractedFields)
    );

    return res.json({
      submission_id: result.lastInsertRowid,
      extracted_fields: extractedFields
    });
  } catch (err) {
    console.error('Upload error:', err);
    return res.status(500).json({ error: err.message || 'Upload failed' });
  }
});

export default router;
