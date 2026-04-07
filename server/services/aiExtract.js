import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export async function extractFields(contractText) {
  const prompt = `You are extracting structured data from a Commercient SYNC customer contract PDF.

Extract EXACTLY the following fields. For each field, provide:
- "value": the extracted value (be specific, not vague)
- "source_text": the exact sentence or phrase from the contract that supports this value (verbatim, max 2 sentences)
- "page_num": which page number you found it on (1-indexed)
- "confidence": "high", "medium", or "low"
- "not_found": true if you genuinely cannot find this field

Fields to extract:

1. customer_name — Legal company name of the customer
2. customer_contact — Primary contact name and title
3. customer_email — Primary contact email
4. erp_system — ERP system name and version if stated
5. crm_system — CRM system name
6. tables_included — List ALL tables/objects being synced, with direction (e.g., "GovWin Accounts → HubSpot Company")
7. sync_direction — One-way ERP→CRM, one-way CRM→ERP, or bi-directional
8. sync_frequency — How often syncs run (e.g., "2x daily", "M-F once at 8am")
9. phase_included — Which phases are in scope (Phase 1 only, Phase 2 only, or both)
10. monthly_saas_fee — Monthly SaaS fee in USD
11. setup_fee — One-time setup fee in USD (may appear as "implementation fee", "onboarding fee", or similar)
12. annual_success_plan — Annual Success Plan fee in USD. IMPORTANT: This field only appears on newer contracts. If you cannot find it explicitly stated, omit this field from your response entirely — do NOT include it with not_found: true.
13. contract_term — Minimum subscription term
13. trial_period — Any trial or POC period details
14. partner_company — CRM consulting/partner company name if listed
15. customer_responsibilities — Key things the customer must do (credentials, installs, etc.)
16. notable_exclusions — Anything explicitly listed as NOT included or requiring additional purchase
17. special_conditions — Any non-standard terms (discounts tied to conditions, special requirements like Zoho Vault, etc.)

Field labels mapping (use these as the "label" field):
customer_name → "Customer Name"
customer_contact → "Customer Contact"
customer_email → "Customer Email"
erp_system → "ERP System"
crm_system → "CRM System"
tables_included → "Tables / Objects Included"
sync_direction → "Sync Direction"
sync_frequency → "Sync Frequency"
phase_included → "Phase Included"
monthly_saas_fee → "Monthly SaaS Fee"
setup_fee → "Setup Fee"
annual_success_plan → "Annual Success Plan"
contract_term → "Contract Term"
trial_period → "Trial Period"
partner_company → "Partner Company"
customer_responsibilities → "Customer Responsibilities"
notable_exclusions → "Notable Exclusions"
special_conditions → "Special Conditions"

Contract text:
${contractText}

Respond ONLY with a valid JSON array. No explanation, no markdown, just the JSON array.
Example format:
[
  {
    "field": "customer_name",
    "label": "Customer Name",
    "value": "Walden Security",
    "source_text": "Commercient Order Form Prepared for: Walden Security",
    "page_num": 8,
    "confidence": "high",
    "not_found": false
  }
]`;

  const message = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 4096,
    messages: [{ role: 'user', content: prompt }]
  });

  const text = message.content[0].text.trim();
  // Strip markdown code fences if present
  const jsonText = text.replace(/^```json?\n?/, '').replace(/\n?```$/, '');
  return JSON.parse(jsonText);
}
