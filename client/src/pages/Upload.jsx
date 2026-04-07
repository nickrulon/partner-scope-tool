import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { uploadContract } from '../api'

const PAM_OPTIONS = ['Robert Pomeroy', 'Maria Lopez']

function StepIndicator({ current }) {
  const steps = ['Upload', 'Review', 'Responsibilities', 'Sign', 'Complete']
  return (
    <div className="step-indicator">
      {steps.map((label, i) => {
        const num = i + 1
        const isDone = num < current
        const isActive = num === current
        return (
          <React.Fragment key={label}>
            {i > 0 && (
              <div className={`step-connector${isDone ? ' done' : ''}`} />
            )}
            <div className="step-item">
              <div className={`step-circle${isActive ? ' active' : isDone ? ' done' : ''}`}>
                {isDone ? '✓' : num}
              </div>
              <span className={`step-label${isActive ? ' active' : isDone ? ' done' : ''}`}>
                {label}
              </span>
            </div>
          </React.Fragment>
        )
      })}
    </div>
  )
}

export default function Upload() {
  const navigate = useNavigate()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [form, setForm] = useState({
    customer_name: '',
    partner_company: '',
    partner_name: '',
    partner_email: '',
    pam_name: '',
    deal_id: '',
  })
  const [file, setFile] = useState(null)

  function handleChange(e) {
    setForm(prev => ({ ...prev, [e.target.name]: e.target.value }))
  }

  function handleFile(e) {
    const f = e.target.files[0]
    if (f && f.type !== 'application/pdf') {
      setError('Please upload a PDF file.')
      setFile(null)
      return
    }
    setError('')
    setFile(f || null)
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')

    if (!file) {
      setError('Please upload a PDF contract.')
      return
    }

    setLoading(true)
    try {
      const fd = new FormData()
      fd.append('customer_name', form.customer_name)
      fd.append('partner_company', form.partner_company)
      fd.append('partner_name', form.partner_name)
      fd.append('partner_email', form.partner_email)
      fd.append('pam_name', form.pam_name)
      fd.append('deal_id', form.deal_id)
      fd.append('contract', file)

      const result = await uploadContract(fd)
      navigate(`/review/${result.submission_id}`)
    } catch (err) {
      setError(err.message || 'Upload failed. Please try again.')
      setLoading(false)
    }
  }

  return (
    <div className="page-wrapper">
      <StepIndicator current={1} />

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20, gap: 16 }}>
        <div>
          <h1 className="page-title">Upload Customer Contract</h1>
          <p className="page-subtitle" style={{ marginBottom: 0 }}>
            Upload a signed Commercient contract PDF. Our AI will extract the key scope fields automatically.
          </p>
        </div>
        <img src="/brand-2.png" alt="" aria-hidden="true" style={{ height: 52, width: 'auto', objectFit: 'contain', opacity: 0.85, flexShrink: 0 }} />
      </div>

      {error && <div className="alert-error">{error}</div>}

      {loading ? (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <img
            src="/fullbleed.png"
            alt="Commercient AI"
            style={{ width: '100%', display: 'block', objectFit: 'cover' }}
          />
          <div style={{ padding: '28px 32px 32px', textAlign: 'center', background: '#071a31' }}>
            <p className="ai-thinking-text">
              Uploading and analyzing contract with AI
              <span className="ai-thinking-dots"><span>.</span><span>.</span><span>.</span></span>
            </p>
            <p className="ai-thinking-sub">This may take 30–60 seconds.</p>
          </div>
        </div>
      ) : (
        <div className="card brand-watermark">
          <form onSubmit={handleSubmit}>
            <div className="form-group">
              <label className="form-label">
                Customer Name <span className="required">*</span>
              </label>
              <input
                className="form-control"
                type="text"
                name="customer_name"
                value={form.customer_name}
                onChange={handleChange}
                placeholder="e.g. Walden Security"
                required
              />
            </div>

            <div className="form-group">
              <label className="form-label">
                Partner Company Name <span className="required">*</span>
              </label>
              <input
                className="form-control"
                type="text"
                name="partner_company"
                value={form.partner_company}
                onChange={handleChange}
                placeholder="e.g. CRM Consulting Partners LLC"
                required
              />
            </div>

            <div className="form-group">
              <label className="form-label">
                Your Name <span className="required">*</span>
              </label>
              <input
                className="form-control"
                type="text"
                name="partner_name"
                value={form.partner_name}
                onChange={handleChange}
                placeholder="Full name"
                required
              />
            </div>

            <div className="form-group">
              <label className="form-label">
                Your Email <span className="required">*</span>
              </label>
              <input
                className="form-control"
                type="email"
                name="partner_email"
                value={form.partner_email}
                onChange={handleChange}
                placeholder="you@yourcompany.com"
                required
              />
            </div>

            <div className="form-group">
              <label className="form-label">
                PAM Name <span className="required">*</span>
              </label>
              <select
                className="form-control"
                name="pam_name"
                value={form.pam_name}
                onChange={handleChange}
                required
              >
                <option value="">Select your PAM...</option>
                {PAM_OPTIONS.map(p => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
            </div>

            <div className="form-group">
              <label className="form-label">Deal ID (optional)</label>
              <input
                className="form-control"
                type="text"
                name="deal_id"
                value={form.deal_id}
                onChange={handleChange}
                placeholder="e.g. DEAL-2026-0042"
              />
            </div>

            <div className="form-group">
              <label className="form-label">
                Upload Contract PDF <span className="required">*</span>
              </label>
              <input
                className="form-control"
                type="file"
                accept=".pdf"
                onChange={handleFile}
                required
              />
              {file && (
                <p style={{ fontSize: 12, color: '#16a34a', marginTop: 6 }}>
                  ✓ {file.name} ({(file.size / 1024).toFixed(0)} KB)
                </p>
              )}
            </div>

            <div className="alert-info">
              <strong>How it works:</strong> Claude AI will read your PDF and extract 17 key scope fields.
              You'll review and confirm each field before signing.
            </div>

            <button type="submit" className="btn-primary" style={{ width: '100%', padding: '12px' }}>
              Upload & Analyze with AI →
            </button>
          </form>
        </div>
      )}
    </div>
  )
}
