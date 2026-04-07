import React, { useState } from 'react'
import { getSubmissions } from '../api'

const STATUS_LABELS = {
  draft: { label: 'In Progress', cls: 'draft' },
  confirmed: { label: 'Awaiting Signature', cls: 'confirmed' },
  signed: { label: '✅ Submitted', cls: 'signed' },
  submitted: { label: '✅ Submitted', cls: 'signed' }
}

export default function Dashboard() {
  const [password, setPassword] = useState('')
  const [submissions, setSubmissions] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [filterPam, setFilterPam] = useState('all')
  const [filterStatus, setFilterStatus] = useState('all')

  async function handleLogin(e) {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      const data = await getSubmissions(password)
      setSubmissions(data)
    } catch (err) {
      if (err.message.includes('401') || err.message.toLowerCase().includes('invalid')) {
        setError('Invalid password. Please try again.')
      } else {
        setError(err.message)
      }
    } finally {
      setLoading(false)
    }
  }

  function formatDate(dt) {
    if (!dt) return '—'
    return new Date(dt).toLocaleDateString('en-US', {
      year: 'numeric', month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit'
    })
  }

  const filtered = (submissions || []).filter(s => {
    if (filterPam !== 'all' && s.pam_name !== filterPam) return false
    if (filterStatus !== 'all' && s.status !== filterStatus) return false
    return true
  })

  // Not logged in yet
  if (!submissions) {
    return (
      <div className="page-wrapper" style={{ maxWidth: 440 }}>
        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <img src="/commercient-logo-dark.png" alt="Commercient" style={{ height: 52, marginBottom: 16, objectFit: 'contain' }} />
          <h1 className="page-title">PAM Dashboard</h1>
          <p className="page-subtitle">Enter your PAM password to view all scope submissions.</p>
        </div>

        <div className="card brand-watermark">
          {error && <div className="alert-error">{error}</div>}

          <form onSubmit={handleLogin}>
            <div className="form-group">
              <label className="form-label">
                PAM Password <span className="required">*</span>
              </label>
              <input
                className="form-control"
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="Enter PAM password"
                required
                autoFocus
              />
            </div>

            <button
              type="submit"
              className="btn-primary"
              style={{ width: '100%' }}
              disabled={loading}
            >
              {loading ? 'Checking...' : 'Access Dashboard'}
            </button>
          </form>
        </div>
      </div>
    )
  }

  return (
    <div style={{ padding: '24px 32px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <img src="/brand-3.png" alt="" aria-hidden="true" style={{ height: 40, width: 'auto', objectFit: 'contain', opacity: 0.9 }} />
          <div>
            <h1 className="page-title">PAM Dashboard</h1>
            <p style={{ fontSize: 13, color: '#6b7280' }}>
              {filtered.length} of {submissions.length} submissions shown
            </p>
          </div>
        </div>
        <button
          className="btn-outline"
          onClick={() => setSubmissions(null)}
        >
          Log Out
        </button>
      </div>

      {/* Filter bar */}
      <div className="filter-bar">
        <span style={{ fontSize: 13, fontWeight: 600, color: '#374151' }}>Filter:</span>

        <select value={filterPam} onChange={e => setFilterPam(e.target.value)}>
          <option value="all">All PAMs</option>
          <option value="Robert Pomeroy">Robert Pomeroy</option>
          <option value="Maria Lopez">Maria Lopez</option>
        </select>

        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
          <option value="all">All Statuses</option>
          <option value="draft">In Progress</option>
          <option value="confirmed">Awaiting Signature</option>
          <option value="signed">Submitted</option>
        </select>

        <button
          className="btn-outline"
          onClick={async () => {
            setLoading(true)
            try {
              const data = await getSubmissions(password)
              setSubmissions(data)
            } catch (err) {
              setError(err.message)
            } finally {
              setLoading(false)
            }
          }}
          style={{ marginLeft: 'auto' }}
        >
          ↻ Refresh
        </button>
      </div>

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        {filtered.length === 0 ? (
          <div style={{ padding: 40, textAlign: 'center', color: '#9ca3af', fontSize: 14 }}>
            No submissions match the current filters.
          </div>
        ) : (
          <table className="dashboard-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Customer</th>
                <th>Partner</th>
                <th>PAM</th>
                <th>Deal ID</th>
                <th>Submitted</th>
                <th>Status</th>
                <th>PDF</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(sub => {
                const statusInfo = STATUS_LABELS[sub.status] || { label: sub.status, cls: 'draft' }
                return (
                  <tr key={sub.id}>
                    <td style={{ color: '#9ca3af', fontSize: 12 }}>#{sub.id}</td>
                    <td>
                      <div style={{ fontWeight: 600 }}>{sub.customer_name}</div>
                      <div style={{ fontSize: 11, color: '#9ca3af' }}>{formatDate(sub.created_at)}</div>
                    </td>
                    <td>
                      <div>{sub.partner_company}</div>
                      <div style={{ fontSize: 11, color: '#9ca3af' }}>{sub.partner_name}</div>
                      <div style={{ fontSize: 11, color: '#9ca3af' }}>{sub.partner_email}</div>
                    </td>
                    <td>{sub.pam_name}</td>
                    <td style={{ fontSize: 12, color: '#6b7280' }}>{sub.deal_id || '—'}</td>
                    <td style={{ fontSize: 12 }}>{formatDate(sub.submitted_at)}</td>
                    <td>
                      <span className={`status-badge ${statusInfo.cls}`}>
                        {statusInfo.label}
                      </span>
                    </td>
                    <td>
                      {sub.output_pdf_path ? (
                        <a
                          href={`/outputs/${sub.id}.pdf`}
                          download
                          className="btn-outline"
                          style={{ fontSize: 11, padding: '4px 10px' }}
                        >
                          ⬇ PDF
                        </a>
                      ) : (
                        <span style={{ fontSize: 11, color: '#d1d5db' }}>—</span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
