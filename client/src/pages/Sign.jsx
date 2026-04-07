import React, { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { getSubmission, signSubmission } from '../api'

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

const ACKS = [
  {
    key: 'ack_cgi',
    title: 'CGI Portal',
    text: 'I have communicated the role and value of the Commercient Guided Implementation (CGI) portal to my customer. My customer understands how the portal supports a structured, successful onboarding experience and knows what to expect at each step of the implementation.'
  },
  {
    key: 'ack_timeline',
    title: 'Timeline',
    text: "I understand this project's timeline is customer-driven. Phase 1 (ERP → CRM) typically takes 2-10 weeks for standard implementations and up to 10+ weeks for more complex projects. Phase 2 (CRM → ERP), if included, follows a similar range. These timelines depend on my customer's responsiveness in providing ERP credentials, completing data verification, and completing account matching. I have communicated these timelines and dependencies to my customer."
  },
  {
    key: 'ack_ticketing',
    title: 'Ticketing',
    text: "I understand Commercient's delivery team responds through their formal ticketing system. I have informed my customer that emails or calls outside of tickets may not receive a response. I know that my PAM (ex. Robert, Maria, etc.) is my first call if I or my customer feels we are struggling to get timely responses from the Commercient team."
  },
  {
    key: 'ack_scope',
    title: 'Scope',
    text: 'I confirm the scope extracted above reflects my understanding of what is included in this contract. I understand that any data, tables, or functionality not listed may require a change order and could extend the project timeline.'
  }
]

export default function Sign() {
  const { id } = useParams()
  const navigate = useNavigate()

  const [submission, setSubmission] = useState(null)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  const [acks, setAcks] = useState({
    ack_cgi: false,
    ack_timeline: false,
    ack_ticketing: false,
    ack_scope: false,
    ack_responsibilities: true  // confirmed on the Responsibilities step
  })
  const [signature, setSignature] = useState('')

  const now = new Date()
  const dateStr = now.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
  const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })

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

  const allAcked = Object.values(acks).every(Boolean)
  const canSubmit = allAcked && signature.trim().length > 2

  async function handleSubmit(e) {
    e.preventDefault()
    if (!canSubmit) return

    setSubmitting(true)
    setError('')
    try {
      await signSubmission(id, {
        ack_cgi: acks.ack_cgi,
        ack_timeline: acks.ack_timeline,
        ack_ticketing: acks.ack_ticketing,
        ack_scope: acks.ack_scope,
        ack_responsibilities: acks.ack_responsibilities,
        partner_signature: signature.trim()
      })
      navigate(`/complete/${id}`)
    } catch (err) {
      setError(err.message)
      setSubmitting(false)
    }
  }

  if (loading) {
    return (
      <div className="loading-wrap" style={{ marginTop: 60 }}>
        <div className="spinner" />
        <p className="loading-text">Loading...</p>
      </div>
    )
  }

  if (error && !submission) {
    return (
      <div className="page-wrapper">
        <div className="alert-error">{error}</div>
      </div>
    )
  }

  return (
    <div className="page-wrapper" style={{ maxWidth: 740 }}>
      <StepIndicator current={4} />

      <h1 className="page-title" style={{ marginTop: 8 }}>Review & Sign</h1>
      <p className="page-subtitle">
        Review the project details, check all acknowledgments, and digitally sign to complete your scope verification.
      </p>

      {/* Project Summary */}
      <div className="card" style={{ marginBottom: 20 }}>
        <h2 className="section-title">Project Summary</h2>
        <div className="summary-grid">
          <div className="summary-item">
            <div className="summary-item-label">Customer</div>
            <div className="summary-item-value">{submission?.customer_name}</div>
          </div>
          <div className="summary-item">
            <div className="summary-item-label">Partner Company</div>
            <div className="summary-item-value">{submission?.partner_company}</div>
          </div>
          <div className="summary-item">
            <div className="summary-item-label">Partner Contact</div>
            <div className="summary-item-value">{submission?.partner_name}</div>
          </div>
          <div className="summary-item">
            <div className="summary-item-label">PAM</div>
            <div className="summary-item-value">{submission?.pam_name}</div>
          </div>
          {submission?.deal_id && (
            <div className="summary-item">
              <div className="summary-item-label">Deal ID</div>
              <div className="summary-item-value">{submission.deal_id}</div>
            </div>
          )}
        </div>
      </div>

      <form onSubmit={handleSubmit}>
        {/* Acknowledgments */}
        <div className="card" style={{ marginBottom: 20 }}>
          <h2 className="section-title">Acknowledgments</h2>
          <p style={{ fontSize: 13, color: '#6b7280', marginBottom: 16 }}>
            You must check all four boxes to proceed.
          </p>

          {ACKS.map(ack => (
            <label
              key={ack.key}
              className={`ack-item${acks[ack.key] ? ' checked' : ''}`}
            >
              <input
                type="checkbox"
                checked={acks[ack.key]}
                onChange={e => setAcks(prev => ({ ...prev, [ack.key]: e.target.checked }))}
              />
              <div>
                <div className="ack-title">{ack.title}</div>
                <div className="ack-text">{ack.text}</div>
              </div>
            </label>
          ))}
        </div>

        {/* Digital Signature */}
        <div className="card" style={{ marginBottom: 20 }}>
          <h2 className="section-title">Digital Signature</h2>

          <p style={{ fontSize: 13, color: '#374151', marginBottom: 20, lineHeight: 1.6 }}>
            By typing my full name below, I confirm that I have reviewed the scope above, understand the
            acknowledgments, and accept responsibility for communicating these expectations to my customer.
          </p>

          <div className="form-group">
            <label className="form-label">
              Full Name <span className="required">*</span>
            </label>
            <input
              className="form-control"
              type="text"
              value={signature}
              onChange={e => setSignature(e.target.value)}
              placeholder="Type your full name to sign"
              style={{
                fontSize: 18,
                fontStyle: 'italic',
                fontFamily: 'Georgia, serif',
                padding: '12px 16px'
              }}
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">Date</label>
              <input
                className="form-control"
                type="text"
                value={dateStr}
                disabled
              />
            </div>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">Time</label>
              <input
                className="form-control"
                type="text"
                value={timeStr}
                disabled
              />
            </div>
          </div>
        </div>

        {error && <div className="alert-error">{error}</div>}

        {submitting ? (
          <div className="loading-wrap">
            <div className="spinner" />
            <p className="loading-text">Generating your Scope Verification PDF...</p>
          </div>
        ) : (
          <button
            type="submit"
            className="btn-primary"
            disabled={!canSubmit}
            style={{ width: '100%', padding: '14px', fontSize: 15 }}
          >
            Submit Scope Verification →
          </button>
        )}

        {!allAcked && (
          <p style={{ fontSize: 12, color: '#9ca3af', textAlign: 'center', marginTop: 8 }}>
            Please check all 4 acknowledgments to enable submission.
          </p>
        )}
      </form>
    </div>
  )
}
