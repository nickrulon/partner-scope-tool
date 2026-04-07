import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const PDFDocument = require('pdfkit');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Commercient brand palette
const NAVY      = '#1c3b60';
const BLUE      = '#19a4d0';
const DEEP_NAVY = '#071a31';
const GREEN     = '#16a34a';
const RED       = '#dc2626';
const GRAY      = '#6b7280';
const DARK      = '#1a1a2e';
const LIGHT_GRAY = '#f3f4f6';
const BORDER_GRAY = '#e5e7eb';
const STEEL_BLUE  = '#a2bedb';

function drawCheckbox(doc, x, y, checked, color) {
  doc.save();
  doc.rect(x, y, 11, 11).strokeColor(color).lineWidth(1.2).stroke();
  if (checked) {
    doc.moveTo(x + 1.5, y + 5.5)
      .lineTo(x + 4.5, y + 8.5)
      .lineTo(x + 10, y + 1.5)
      .strokeColor(color).lineWidth(1.8).stroke();
  }
  doc.restore();
}

// Draw a section page header (title + divider) — returns new y position
function drawPageHeader(doc, title) {
  doc.fontSize(15).fillColor(NAVY).font('Helvetica-Bold').text(title, 50, 50);
  const lineY = 50 + 20;
  doc.moveTo(50, lineY).lineTo(562, lineY).strokeColor(NAVY).lineWidth(2).stroke();
  return lineY + 14;
}

// Measure the height a field box needs given its content
function fieldBoxHeight(doc, value, isFlagged, note) {
  const PADDING = 20; // top + bottom
  const LABEL_H = 12;
  const GAP = 6;

  doc.fontSize(10).font('Helvetica');
  const valueH = doc.heightOfString(String(value || 'Not provided'), { width: 490 });

  let noteH = 0;
  if (isFlagged && note) {
    doc.fontSize(9).font('Helvetica-Oblique');
    noteH = doc.heightOfString(`Note: ${note}`, { width: 490 }) + GAP;
  }

  return PADDING + LABEL_H + GAP + valueH + noteH;
}

export async function generateScopeVerificationPDF(submission, outputPath) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ margin: 50, size: 'LETTER' });
      const writeStream = fs.createWriteStream(outputPath);
      doc.pipe(writeStream);

      const logoPath = path.join(__dirname, '..', 'commercient-logo.jpg');
      const now = new Date();
      const dateStr = now.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
      const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZoneName: 'short' });

      let confirmedFields = [];
      let extractedFields = [];

      try {
        confirmedFields = typeof submission.confirmed_fields === 'string'
          ? JSON.parse(submission.confirmed_fields)
          : (submission.confirmed_fields || []);
      } catch (e) { confirmedFields = []; }

      try {
        extractedFields = typeof submission.extracted_fields === 'string'
          ? JSON.parse(submission.extracted_fields)
          : (submission.extracted_fields || []);
      } catch (e) { extractedFields = []; }

      const flaggedFields = confirmedFields.filter(f => f.status === 'flagged');

      // ─── PAGE 1: Header + Project Summary ────────────────────────────────────

      // Dark header band
      doc.rect(0, 0, 612, 80).fill(DEEP_NAVY);

      if (fs.existsSync(logoPath)) {
        doc.image(logoPath, 50, 16, { height: 40, fit: [160, 40] });
      }

      doc.fontSize(11).fillColor(STEEL_BLUE).font('Helvetica')
        .text('SCOPE VERIFICATION RECORD', 0, 30, { align: 'center', width: 612 });
      doc.fontSize(7).fillColor(STEEL_BLUE).font('Helvetica')
        .text(`Generated: ${dateStr} at ${timeStr}`, 0, 47, { align: 'center', width: 612 });

      doc.y = 100;

      // PROJECT DETAILS section
      doc.fontSize(13).fillColor(NAVY).font('Helvetica-Bold').text('PROJECT DETAILS', 50, doc.y);
      doc.moveDown(0.4);

      const details = [
        ['Customer Name',   submission.customer_name],
        ['Partner Company', submission.partner_company],
        ['Partner Contact', submission.partner_name],
        ['Partner Email',   submission.partner_email],
        ['PAM',             submission.pam_name],
        ['Deal ID',         submission.deal_id || 'N/A'],
        ['Verification Date', dateStr],
        ['Document ID',     `${submission.id}-${now.getTime()}`],
      ];

      details.forEach(([label, value]) => {
        const y = doc.y;
        doc.fontSize(10).fillColor(GRAY).font('Helvetica-Bold')
          .text(label + ':', 50, y, { width: 160 });
        doc.fontSize(10).fillColor(DARK).font('Helvetica')
          .text(String(value || 'N/A'), 215, y, { width: 340 });
        doc.moveDown(0.35);
      });

      doc.moveDown(0.5);
      doc.moveTo(50, doc.y).lineTo(562, doc.y).strokeColor(BORDER_GRAY).lineWidth(1).stroke();

      // ─── PAGE 2: Confirmed Scope ──────────────────────────────────────────────

      doc.addPage();
      let y = drawPageHeader(doc, 'CONFIRMED SCOPE');
      doc.y = y;

      const fieldsToShow = confirmedFields.length > 0 ? confirmedFields : extractedFields;

      if (fieldsToShow.length === 0) {
        doc.fontSize(10).fillColor(GRAY).font('Helvetica').text('No confirmed fields recorded.', 50, doc.y);
      } else {
        fieldsToShow.forEach((field) => {
          const isFlagged = field.status === 'flagged';
          const label  = field.label || field.field || '';
          const value  = field.confirmed_value || field.value || 'Not provided';
          const note   = field.partner_note || '';

          const boxH = fieldBoxHeight(doc, value, isFlagged, note);

          // Page break if needed
          if (doc.y + boxH > 720) {
            doc.addPage();
            doc.y = 60;
          }

          const startY   = doc.y;
          const boxColor = isFlagged ? '#fff5f5' : '#f0fff4';
          const borderColor = isFlagged ? RED : GREEN;

          doc.rect(50, startY, 512, boxH).fillAndStroke(boxColor, borderColor);

          doc.fontSize(9).fillColor(GRAY).font('Helvetica-Bold')
            .text(label.toUpperCase(), 60, startY + 10, { width: 490 });

          doc.fontSize(10).fillColor(DARK).font('Helvetica')
            .text(String(value), 60, startY + 22, { width: 490 });

          if (isFlagged && note) {
            const noteY = startY + 22 + doc.heightOfString(String(value), { width: 490 }) + 6;
            doc.fontSize(9).fillColor(RED).font('Helvetica-Oblique')
              .text(`Note: ${note}`, 60, noteY, { width: 490 });
          }

          doc.y = startY + boxH + 6;
        });
      }

      // Flagged summary
      if (flaggedFields.length > 0) {
        if (doc.y > 640) { doc.addPage(); doc.y = 60; }
        doc.moveDown(0.5);
        doc.fontSize(12).fillColor(RED).font('Helvetica-Bold')
          .text('** FLAGGED FIELDS REQUIRING ATTENTION **', 50, doc.y);
        doc.moveDown(0.3);
        flaggedFields.forEach((field) => {
          doc.fontSize(10).fillColor(RED).font('Helvetica-Bold')
            .text(`• ${field.label || field.field}: `, 50, doc.y, { continued: true });
          doc.font('Helvetica').fillColor(DARK)
            .text(field.partner_note || 'Flagged as unclear');
          doc.moveDown(0.2);
        });
      }

      // ─── PAGE 3: Scope & Responsibilities Acknowledgment ─────────────────────

      doc.addPage();
      drawPageHeader(doc, 'SCOPE & RESPONSIBILITIES ACKNOWLEDGMENT');

      // Two columns
      const colY = 86;
      const colW = 236;
      const col1X = 50;
      const col2X = 310;
      const itemH = 44;

      // Column headers
      doc.rect(col1X, colY, colW, 22).fillAndStroke('#f0fff4', GREEN);
      doc.fontSize(10).fillColor(GREEN).font('Helvetica-Bold')
        .text('Commercient IS Responsible For', col1X + 6, colY + 6, { width: colW - 12 });

      doc.rect(col2X, colY, colW, 22).fillAndStroke('#fff5f5', RED);
      doc.fontSize(10).fillColor(RED).font('Helvetica-Bold')
        .text('Commercient Is NOT Responsible For', col2X + 6, colY + 6, { width: colW - 12 });

      const responsibleItems = [
        'Moving and mapping data between your ERP, CRM, and connected systems',
        'Running scheduled syncs on the agreed cadence (e.g. 2x/day)',
        'Configuring and delivering Phase 1 (ERP -> CRM): setup, data validation, CRM layout training, log monitoring, and sign-off',
        'Configuring and delivering Phase 2 (CRM -> ERP), if included: posting logic setup, field validation, transaction testing, and go-live support',
        'Technical data transformation required to make the integration work (SQL views, field mapping, data joins)',
        'Account matching -- linking ERP and CRM records via unique keys',
        'Monitoring sync logs and resolving integration errors',
        'Providing Admin Panel tools: sync history, logs, resync capabilities, and change request tools',
        'Populating CRM with ERP data and posting CRM data back to ERP',
      ];

      const notResponsibleItems = [
        'Cleaning, normalizing, deduplicating, or fixing data inside your ERP or CRM',
        'CRM configuration: workflows, automation, reporting, UI setup, or pipeline stages',
        'ERP configuration or internal business rules',
        'Business logic: pricing strategies, sales processes, or operational workflows',
        'How data behaves inside destination systems after it lands',
        'Guaranteeing the accuracy of source data',
        'Acting as a CRM admin, ERP consultant, or RevOps resource',
        'Building reports, dashboards, or analytics',
        'Adding new tables, endpoints, or data outside the contracted scope -- this requires a re-quote',
        'Major scope changes without re-quote: new objects, direction changes, or historical data backfills',
      ];

      const maxItems = Math.max(responsibleItems.length, notResponsibleItems.length);
      const listY = colY + 28;

      responsibleItems.forEach((item, i) => {
        doc.fontSize(8.5).fillColor(DARK).font('Helvetica')
          .text(`• ${item}`, col1X + 6, listY + i * itemH, { width: colW - 12 });
      });

      notResponsibleItems.forEach((item, i) => {
        doc.fontSize(8.5).fillColor(DARK).font('Helvetica')
          .text(`• ${item}`, col2X + 6, listY + i * itemH, { width: colW - 12 });
      });

      doc.y = listY + maxItems * itemH + 12;

      // Essential Boundary callout
      const calloutY = doc.y;
      const calloutH = 88;
      doc.rect(50, calloutY, 512, calloutH).fillAndStroke('#eef7fc', BLUE);
      doc.fontSize(10).fillColor(BLUE).font('Helvetica-Bold')
        .text('The Essential Boundary', 62, calloutY + 10, { width: 490 });
      doc.fontSize(9).fillColor(DARK).font('Helvetica')
        .text(
          'Commercient is responsible for moving and mapping data between systems accurately and consistently. The partner and customer are responsible for how that data is structured, cleaned, and used within each system.',
          62, calloutY + 24, { width: 490 }
        );
      doc.fontSize(8.5).fillColor(GRAY).font('Helvetica-Oblique')
        .text(
          'Note: Commercient performs technical transformation required for integration (mapping, SQL views, posting logic) -- not business transformation (logic, strategy, or system behavior).',
          62, calloutY + 56, { width: 490 }
        );

      doc.y = calloutY + calloutH + 10;

      // Out-of-Scope Examples
      const outOfScopeExamples = [
        '"Fix duplicate records in our CRM"',
        '"Clean or normalize our ERP data"',
        '"Change our pricing logic or business rules"',
        '"Build workflows in Salesforce or HubSpot"',
        '"Make synced data behave differently after it lands"',
      ];

      // Page break if needed before out-of-scope box
      if (doc.y + 120 > 740) { doc.addPage(); doc.y = 50; }

      const oosY = doc.y;
      const oosH = 22 + outOfScopeExamples.length * 17 + 14;
      doc.rect(50, oosY, 512, oosH).fillAndStroke('#fffbeb', '#f59e0b');
      doc.fontSize(9.5).fillColor('#92400e').font('Helvetica-Bold')
        .text('Common Requests That Fall Outside Commercient Scope', 62, oosY + 10, { width: 490 });
      outOfScopeExamples.forEach((ex, i) => {
        const exY = oosY + 26 + i * 17;
        doc.fontSize(8.5).fillColor('#78350f').font('Helvetica')
          .text(`${ex}  --  not in scope`, 70, exY, { width: 480 });
      });

      doc.y = oosY + oosH + 12;

      // Page break if needed before confirmation
      if (doc.y + 60 > 740) { doc.addPage(); doc.y = 50; }

      // Responsibilities confirmation checkbox
      const respChecked = !!submission.ack_responsibilities;
      const respCheckColor = respChecked ? GREEN : RED;
      const respY = doc.y;
      drawCheckbox(doc, 50, respY + 1, respChecked, respCheckColor);
      doc.fontSize(10).fillColor('#374151').font('Helvetica')
        .text(
          'I have read and understood what Commercient is and is not responsible for on this project. I will communicate these boundaries to my customer so we are aligned before kickoff.',
          75, respY, { width: 487 }
        );

      if (submission.partner_signature && submission.signature_timestamp) {
        doc.moveDown(0.4);
        doc.fontSize(8.5).fillColor(GRAY).font('Helvetica-Oblique')
          .text(
            `Confirmed by: ${submission.partner_signature} -- ${new Date(submission.signature_timestamp).toLocaleString('en-US')}`,
            75, doc.y, { width: 487 }
          );
      }

      // ─── PAGE 4: Partner Acknowledgments ─────────────────────────────────────

      doc.addPage();
      drawPageHeader(doc, 'PARTNER ACKNOWLEDGMENTS');
      doc.y = 86;

      const acks = [
        {
          label: 'CGI Portal',
          checked: !!submission.ack_cgi,
          text: 'Partner has communicated the role and value of the Commercient Guided Implementation (CGI) portal to the customer. The customer understands how the portal supports a structured, successful onboarding experience and knows what to expect at each step of the implementation.',
        },
        {
          label: 'Timeline',
          checked: !!submission.ack_timeline,
          text: 'Partner understands and has communicated that timeline is customer-driven and dependent on customer actions. Key milestones depend on the customer providing ERP credentials, completing data verification, and responding to account matching requests. Phase 1 (ERP -> CRM) typically takes 2-10 weeks for standard implementations and up to 10+ weeks for complex projects.',
        },
        {
          label: 'Ticketing',
          checked: !!submission.ack_ticketing,
          text: "Partner understands Commercient's ticketing requirements and has communicated the support process to the customer. Commercient's delivery team responds through their formal ticketing system -- emails or calls outside of tickets may not receive a response.",
        },
        {
          label: 'Scope',
          checked: !!submission.ack_scope,
          text: 'Partner confirms the scope above matches their contract understanding. Any data, tables, or functionality not listed may require a change order and could extend the project timeline.',
        },
      ];

      acks.forEach((ack, idx) => {
        // Measure height needed
        doc.fontSize(10).font('Helvetica');
        const textH = doc.heightOfString(ack.text, { width: 487 });
        const blockH = 18 + textH + 10; // label row + text + padding

        if (doc.y + blockH > 720) { doc.addPage(); doc.y = 60; }

        const startY = doc.y;
        const checkColor = ack.checked ? GREEN : RED;

        drawCheckbox(doc, 50, startY + 2, ack.checked, checkColor);

        doc.fontSize(11).fillColor(NAVY).font('Helvetica-Bold')
          .text(ack.label, 75, startY, { width: 487 });

        doc.fontSize(10).fillColor('#374151').font('Helvetica')
          .text(ack.text, 75, doc.y, { width: 487 });

        doc.moveDown(0.8);

        if (idx < acks.length - 1) {
          doc.moveTo(75, doc.y).lineTo(562, doc.y).strokeColor(BORDER_GRAY).lineWidth(0.5).stroke();
          doc.moveDown(0.5);
        }
      });

      // ─── PAGE 5: Digital Signature ────────────────────────────────────────────

      doc.addPage();
      drawPageHeader(doc, 'DIGITAL SIGNATURE');
      doc.y = 86;

      doc.fontSize(10).fillColor('#374151').font('Helvetica')
        .text(
          'By providing the digital signature below, the partner confirms that they have reviewed the scope above, understand all acknowledgments, and accept responsibility for communicating these expectations to their customer.',
          50, doc.y, { width: 512 }
        );

      doc.moveDown(1.2);

      const sigBoxY = doc.y;
      doc.rect(50, sigBoxY, 512, 200).fillAndStroke(LIGHT_GRAY, BORDER_GRAY);

      const sigFields = [
        ['Signed By',   submission.partner_signature || 'N/A'],
        ['Company',     submission.partner_company || 'N/A'],
        ['Email',       submission.partner_email || 'N/A'],
        ['Date',        submission.signature_timestamp
          ? new Date(submission.signature_timestamp).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
          : dateStr],
        ['Time',        submission.signature_timestamp
          ? new Date(submission.signature_timestamp).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZoneName: 'short' })
          : timeStr],
        ['IP Address',  submission.signature_ip || 'N/A'],
        ['Document ID', `${submission.id}-${now.getTime()}`],
      ];

      let sigY = sigBoxY + 15;
      sigFields.forEach(([label, value]) => {
        doc.fontSize(9).fillColor(GRAY).font('Helvetica-Bold').text(label + ':', 65, sigY, { width: 130 });
        doc.fontSize(9).fillColor(DARK).font('Helvetica').text(String(value), 200, sigY, { width: 350 });
        sigY += 22;
      });

      doc.y = sigBoxY + 215;
      doc.moveDown(1);

      doc.moveTo(50, doc.y).lineTo(562, doc.y).strokeColor(BORDER_GRAY).lineWidth(1).stroke();
      doc.moveDown(0.5);
      doc.fontSize(8).fillColor(GRAY).font('Helvetica')
        .text(
          `This Scope Verification Record was digitally signed and is legally binding. Generated by Commercient Partner Scope Tool on ${dateStr}. Document ID: ${submission.id}-${now.getTime()}.`,
          50, doc.y, { width: 512, align: 'center' }
        );

      doc.end();

      writeStream.on('finish', () => resolve(outputPath));
      writeStream.on('error', reject);
    } catch (err) {
      reject(err);
    }
  });
}
