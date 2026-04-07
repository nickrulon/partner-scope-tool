import React, { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { getSubmission } from '../api'

const STEPS = ['Upload', 'Review', 'Responsibilities', 'Sign', 'Complete']

function StepIndicator({ current }) {
  return (
    <div className="step-indicator" style={{ padding: '12px 20px', background: '#fff', borderBottom: '1px solid #e5e7eb' }}>
      {STEPS.map((label, i) => {
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

const RESPONSIBLE_ITEMS = [
  'Moving and mapping data between your ERP, CRM, and connected systems',
  'Running scheduled syncs on the agreed cadence (e.g. 2×/day)',
  'Configuring and delivering Phase 1 (ERP → CRM): setup, data validation, CRM layout training, log monitoring, and sign-off',
  'Configuring and delivering Phase 2 (CRM → ERP), if included: posting logic setup, field validation, transaction testing, and go-live support',
  'Technical data transformation required to make the integration work (SQL views, field mapping, data joins)',
  'Account matching — linking ERP and CRM records via unique keys',
  'Monitoring sync logs and resolving integration errors',
  'Providing Admin Panel tools: sync history, logs, resync capabilities, and change request tools',
  'Populating CRM with ERP data and posting CRM data back to ERP',
]

const NOT_RESPONSIBLE_ITEMS = [
  'Cleaning, normalizing, deduplicating, or fixing data inside your ERP or CRM',
  'CRM configuration: workflows, automation, reporting, UI setup, or pipeline stages',
  'ERP configuration or internal business rules',
  'Business logic: pricing strategies, sales processes, or operational workflows',
  'How data behaves inside destination systems after it lands',
  'Guaranteeing the accuracy of source data',
  'Acting as a CRM admin, ERP consultant, or RevOps resource',
  'Building reports, dashboards, or analytics',
  'Adding new tables, endpoints, or data outside the contracted scope — this requires a re-quote',
  'Major scope changes without re-quote: new objects, direction changes, or historical data backfills',
]

const OUT_OF_SCOPE_EXAMPLES = [
  '"Fix duplicate records in our CRM"',
  '"Clean or normalize our ERP data"',
  '"Change our pricing logic or business rules"',
  '"Build workflows in Salesforce or HubSpot"',
  '"Make synced data behave differently after it lands"',
]

export default function Responsibilities() {
  const { id } = useParams()
  const navigate = useNavigate()

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [checkedResponsible, setCheckedResponsible] = useState(() => Object.fromEntries(RESPONSIBLE_ITEMS.map((_, i) => [i, false])))
  const [checkedNot, setCheckedNot] = useState(() => Object.fromEntries(NOT_RESPONSIBLE_ITEMS.map((_, i) => [i, false])))
  const bottomRef = useRef(null)

  const allItemsChecked =
    Object.values(checkedResponsible).every(Boolean) &&
    Object.values(checkedNot).every(Boolean)

  useEffect(() => {
    async function load() {
      try {
        await getSubmission(id) // validate submission exists
      } catch (err) {
        setError(err.message)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [id])

  function handleContinue() {
    if (!confirmed) return
    navigate(`/sign/${id}`)
  }

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

  return (
    <>
      <StepIndicator current={3} />

      <div className="page-wrapper brand-watermark" style={{ maxWidth: 900 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginTop: 16, marginBottom: 4 }}>
          <h1 className="page-title">
            What Commercient Is — and Isn't — Responsible For
          </h1>
          <img src="/commercient-logo-dark.png" alt="" aria-hidden="true" style={{ height: 32, objectFit: 'contain', opacity: 0.35, flexShrink: 0, marginLeft: 16 }} />
        </div>
        <p className="page-subtitle">
          Read through this carefully before proceeding. You'll need to confirm you've read it before you can sign.
        </p>

        {/* Two-column responsibility layout */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 16,
          marginBottom: 20,
        }}
          className="resp-grid"
        >
          {/* Left: Responsible */}
          <div className="card" style={{ padding: 0, overflow: 'hidden', border: '2px solid #16a34a' }}>
            <div style={{ background: '#f0fff4', padding: '14px 20px', borderBottom: '1px solid #bbf7d0' }}>
              <h2 style={{ fontSize: 15, fontWeight: 700, color: '#15803d', margin: 0 }}>
                ✅ Commercient Is Responsible For
              </h2>
            </div>
            <div style={{ padding: '12px 16px' }}>
              {RESPONSIBLE_ITEMS.map((item, i) => (
                <label key={i} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', cursor: 'pointer', marginBottom: 10, padding: '6px 8px', borderRadius: 6, background: checkedResponsible[i] ? '#dcfce7' : 'transparent', transition: 'background 0.15s' }}>
                  <input
                    type="checkbox"
                    checked={checkedResponsible[i]}
                    onChange={e => setCheckedResponsible(prev => ({ ...prev, [i]: e.target.checked }))}
                    style={{ marginTop: 2, width: 16, height: 16, flexShrink: 0, cursor: 'pointer', accentColor: '#16a34a' }}
                  />
                  <span style={{ fontSize: 13.5, color: '#1a1a2e', lineHeight: 1.6 }}>{item}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Right: Not Responsible */}
          <div className="card" style={{ padding: 0, overflow: 'hidden', border: '2px solid #dc2626' }}>
            <div style={{ background: '#fff5f5', padding: '14px 20px', borderBottom: '1px solid #fecaca' }}>
              <h2 style={{ fontSize: 15, fontWeight: 700, color: '#b91c1c', margin: 0 }}>
                🚫 Commercient Is NOT Responsible For
              </h2>
            </div>
            <div style={{ padding: '12px 16px' }}>
              {NOT_RESPONSIBLE_ITEMS.map((item, i) => (
                <label key={i} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', cursor: 'pointer', marginBottom: 10, padding: '6px 8px', borderRadius: 6, background: checkedNot[i] ? '#fee2e2' : 'transparent', transition: 'background 0.15s' }}>
                  <input
                    type="checkbox"
                    checked={checkedNot[i]}
                    onChange={e => setCheckedNot(prev => ({ ...prev, [i]: e.target.checked }))}
                    style={{ marginTop: 2, width: 16, height: 16, flexShrink: 0, cursor: 'pointer', accentColor: '#dc2626' }}
                  />
                  <span style={{ fontSize: 13.5, color: '#1a1a2e', lineHeight: 1.6 }}>{item}</span>
                </label>
              ))}
            </div>
          </div>
        </div>

        {/* Callout box */}
        <div style={{
          background: '#eef7fc',
          border: '2px solid #19a4d0',
          borderRadius: 10,
          padding: '20px 24px',
          marginBottom: 20,
          textAlign: 'center',
        }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#1c3b60', marginBottom: 10 }}>
            The Essential Boundary
          </div>
          <p style={{ fontSize: 14, color: '#1a1a2e', lineHeight: 1.7, margin: '0 0 10px' }}>
            Commercient is responsible for <strong>moving and mapping data between systems</strong> accurately and consistently.
            The partner and customer are responsible for how that data is <strong>structured, cleaned, and used</strong> within each system.
          </p>
          <p style={{ fontSize: 12.5, color: '#6b7280', margin: 0, fontStyle: 'italic' }}>
            Note: Commercient does perform technical transformation required for integration — mapping, SQL views, posting logic.
            Commercient does <em>not</em> perform business transformation — logic, strategy, or system behavior.
          </p>
        </div>

        {/* Expandable out-of-scope examples */}
        <div style={{
          background: '#fffbeb',
          border: '1px solid #fcd34d',
          borderRadius: 10,
          marginBottom: 24,
          overflow: 'hidden',
        }}>
          <button
            type="button"
            onClick={() => setExpanded(v => !v)}
            style={{
              width: '100%',
              textAlign: 'left',
              padding: '14px 20px',
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              fontSize: 13.5,
              fontWeight: 600,
              color: '#92400e',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            ⚠️ Common requests that fall outside Commercient scope
            <span style={{ fontSize: 18, fontWeight: 400 }}>{expanded ? '▲' : '▼'}</span>
          </button>
          {expanded && (
            <ul style={{ margin: 0, padding: '0 20px 16px 40px', listStyle: 'disc' }}>
              {OUT_OF_SCOPE_EXAMPLES.map((item, i) => (
                <li key={i} style={{ fontSize: 13, color: '#78350f', lineHeight: 1.8 }}>
                  {item} — <span style={{ color: '#b91c1c', fontWeight: 600 }}>not in scope</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Confirmation checkbox */}
        {!allItemsChecked && (
          <div style={{ background: '#fffbeb', border: '1px solid #fcd34d', borderRadius: 8, padding: '12px 16px', marginBottom: 16, fontSize: 13, color: '#92400e' }}>
            ☝️ Check each item above to confirm you've read it before proceeding.
          </div>
        )}

        <div ref={bottomRef} style={{
          background: '#fff',
          border: `2px solid ${confirmed ? '#16a34a' : allItemsChecked ? '#e5e7eb' : '#d1d5db'}`,
          borderRadius: 10,
          padding: '20px 24px',
          marginBottom: 24,
          transition: 'border-color 0.2s',
          opacity: allItemsChecked ? 1 : 0.45,
        }}>
          <label style={{ display: 'flex', gap: 14, alignItems: 'flex-start', cursor: allItemsChecked ? 'pointer' : 'not-allowed' }}>
            <input
              type="checkbox"
              checked={confirmed}
              disabled={!allItemsChecked}
              onChange={e => setConfirmed(e.target.checked)}
              style={{ marginTop: 3, width: 18, height: 18, flexShrink: 0, cursor: allItemsChecked ? 'pointer' : 'not-allowed' }}
            />
            <span style={{ fontSize: 14, color: '#1a1a2e', lineHeight: 1.6 }}>
              I have read and understood what Commercient is and is not responsible for on this project.
              I will communicate these boundaries to my customer so we are aligned before kickoff.
            </span>
          </label>
        </div>

        <button
          type="button"
          onClick={handleContinue}
          disabled={!confirmed || !allItemsChecked}
          className="btn-primary"
          style={{ width: '100%', padding: '14px', fontSize: 15 }}
        >
          Continue to Sign →
        </button>

        {!allItemsChecked && (
          <p style={{ fontSize: 12, color: '#9ca3af', textAlign: 'center', marginTop: 8 }}>
            Check all items in both columns to unlock the confirmation.
          </p>
        )}
        {allItemsChecked && !confirmed && (
          <p style={{ fontSize: 12, color: '#9ca3af', textAlign: 'center', marginTop: 8 }}>
            Check the confirmation box above to proceed.
          </p>
        )}
      </div>

      <style>{`
        @media (max-width: 680px) {
          .resp-grid { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </>
  )
}
