import React, { useState, useEffect } from 'react'
import { useParams, Link } from 'react-router-dom'
import { getSubmission } from '../api'

const PAM_EMAILS = {
  'Robert Pomeroy': 'robertp@commercient.com',
  'Maria Lopez': 'marial@commercient.com'
}

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
            {i > 0 && <div className={`step-connector${isDone ? ' done' : ''}`} />}
            <div className="step-item">
              <div className={`step-circle${isActive ? ' active' : isDone ? ' done' : ''}`}>
                {isDone ? '✓' : num}
              </div>
              <span className={`step-label${isActive ? ' active' : isDone ? ' done' : ''}`}>{label}</span>
            </div>
          </React.Fragment>
        )
      })}
    </div>
  )
}

export default function Complete() {
  const { id } = useParams()
  const [submission, setSubmission] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    async function load() {
      try {
        const sub = await getSubmission(id)
        setSubmission(sub)
      } catch (err) {
        setError(err.message)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [id])

  if (loading) {
    return (
      <div className="loading-wrap" style={{ marginTop: 60 }}>
        <div className="spinner" />
        <p className="loading-text">Loading...</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="page-wrapper">
        <div className="alert-error">{error}</div>
      </div>
    )
  }

  const pamEmail = PAM_EMAILS[submission?.pam_name] || 'pam@commercient.com'
  const completedDate = submission?.submitted_at
    ? new Date(submission.submitted_at).toLocaleDateString('en-US', {
        year: 'numeric', month: 'long', day: 'numeric'
      })
    : new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })

  const mailtoSubject = encodeURIComponent(`Scope Verification – ${submission?.customer_name || ''}`)
  const mailtoBody = encodeURIComponent(
    `Hi ${submission?.pam_name || ''},\n\nPlease find the scope verification attached for ${submission?.customer_name || ''}.${submission?.deal_id ? ` Deal ID: ${submission.deal_id}.` : ''}\n\nBest,\n${submission?.partner_name || ''}`
  )

  return (
    <div className="page-wrapper" style={{ maxWidth: 640 }}>
      <StepIndicator current={5} />

      <div className="card brand-watermark" style={{ textAlign: 'center', padding: '40px 32px' }}>
        <img src="/brand-4.png" alt="" aria-hidden="true" style={{ height: 48, width: 'auto', objectFit: 'contain', marginBottom: 16, opacity: 0.9 }} />
        <h1 className="complete-title">Scope Verification Complete</h1>
        <p className="complete-subtitle">
          Your scope verification has been digitally signed and the PDF has been generated.
        </p>

        {/* Summary */}
        <div style={{ background: '#f8f9fa', borderRadius: 8, padding: '16px 20px', textAlign: 'left', marginBottom: 24 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            {[
              ['Customer', submission?.customer_name],
              ['Partner', submission?.partner_company],
              ['PAM', submission?.pam_name],
              ['Completed', completedDate]
            ].map(([label, val]) => (
              <div key={label}>
                <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', color: '#9ca3af', marginBottom: 2 }}>{label}</div>
                <div style={{ fontSize: 14, fontWeight: 600, color: '#1a1a2e' }}>{val || '—'}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Download button */}
        <a
          href={`/outputs/${id}.pdf`}
          download={`scope-verification-${submission?.customer_name?.replace(/\s+/g, '-').toLowerCase() || id}.pdf`}
          className="btn-primary"
          style={{ display: 'inline-block', padding: '12px 28px', fontSize: 15, marginBottom: 24 }}
        >
          ⬇ Download Scope Verification PDF
        </a>

        <hr className="divider" />

        {/* Email to PAM */}
        <div style={{ textAlign: 'left' }}>
          <h3 className="section-title">Email to PAM</h3>

          <div className="alert-info" style={{ marginBottom: 16 }}>
            <strong>Next step:</strong> Email this PDF to your PAM to confirm commission eligibility for this deal.
          </div>

          <div style={{ background: '#f8f9fa', border: '1px solid #e5e7eb', borderRadius: 8, padding: 16, marginBottom: 16 }}>
            <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 4 }}>Sending to:</div>
            <div style={{ fontSize: 14, fontWeight: 600, color: '#1c3b60' }}>
              {submission?.pam_name} — {pamEmail}
            </div>
          </div>

          <a
            href={`mailto:${pamEmail}?subject=${mailtoSubject}&body=${mailtoBody}`}
            className="btn-outline"
            style={{ display: 'inline-block', marginBottom: 8 }}
          >
            ✉ Open Email to {submission?.pam_name}
          </a>

          <p style={{ fontSize: 12, color: '#9ca3af', marginTop: 8 }}>
            Attach the downloaded PDF to this email before sending.
          </p>
        </div>

        <hr className="divider" />

        <Link to="/upload" className="btn-outline">
          + Start Another Submission
        </Link>
      </div>
    </div>
  )
}
