import React, { useState, useEffect, useRef, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Document, Page, pdfjs } from 'react-pdf'
import 'react-pdf/dist/Page/AnnotationLayer.css'
import 'react-pdf/dist/Page/TextLayer.css'
import { getSubmission, saveVerification } from '../api'

// react-pdf v9 uses pdfjs-dist v4 — use the CDN worker for that version
pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`

function StepIndicator({ current }) {
  const steps = ['Upload', 'Review', 'Responsibilities', 'Sign', 'Complete']
  return (
    <div className="step-indicator" style={{ padding: '12px 20px', background: '#fff', borderBottom: '1px solid #e5e7eb' }}>
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

function FieldCard({ field, fieldState, onConfirm, onFlag, onEdit, onClick }) {
  const [noteText, setNoteText] = useState(fieldState?.partner_note || '')
  const [editValue, setEditValue] = useState(fieldState?.confirmed_value || field.value || '')
  const [showEdit, setShowEdit] = useState(false)
  const [showNote, setShowNote] = useState(fieldState?.status === 'flagged')

  const status = fieldState?.status

  function handleConfirm() {
    onConfirm(field.field, editValue || field.value || '')
    setShowEdit(false)
    setShowNote(false)
  }

  function handleFlag() {
    setShowNote(true)
    onFlag(field.field, editValue || field.value || '', noteText)
  }

  function handleNoteChange(e) {
    setNoteText(e.target.value)
    if (status === 'flagged') {
      onFlag(field.field, editValue || field.value || '', e.target.value)
    }
  }

  function handleEditSave() {
    if (status === 'confirmed') {
      onConfirm(field.field, editValue)
    } else if (status === 'flagged') {
      onFlag(field.field, editValue, noteText)
    }
    setShowEdit(false)
  }

  const cardClass = `field-card${status === 'confirmed' ? ' confirmed' : status === 'flagged' ? ' flagged' : field.not_found ? ' not-found' : ''}`

  const confidenceColor = field.confidence === 'high' ? 'high' : field.confidence === 'medium' ? 'medium' : 'low'

  return (
    <div className={cardClass} onClick={() => onClick && onClick(field.page_num)}>
      <div className="field-label">{field.label || field.field}</div>

      {field.not_found ? (
        <div style={{ fontSize: 12, color: '#92400e', marginBottom: 8, fontStyle: 'italic' }}>
          ⚠ Not Found — Manual Entry Required
        </div>
      ) : (
        <>
          {showEdit ? (
            <textarea
              className="field-note-input"
              value={editValue}
              onChange={e => setEditValue(e.target.value)}
              onClick={e => e.stopPropagation()}
              rows={3}
              style={{ marginBottom: 6 }}
            />
          ) : (
            <div className="field-value">{fieldState?.confirmed_value || field.value || '—'}</div>
          )}

          {field.source_text && !showEdit && (
            <div className="field-source">"{field.source_text}"</div>
          )}
        </>
      )}

      {field.not_found && (
        <textarea
          className="field-note-input"
          value={editValue}
          onChange={e => setEditValue(e.target.value)}
          onClick={e => e.stopPropagation()}
          placeholder="Enter value manually..."
          rows={2}
          style={{ marginBottom: 8 }}
        />
      )}

      <div className="field-actions" onClick={e => e.stopPropagation()}>
        <span className={`confidence-badge ${confidenceColor}`}>
          {field.confidence || 'low'} confidence
        </span>

        {field.page_num && (
          <span style={{ fontSize: 11, color: '#9ca3af' }}>p.{field.page_num}</span>
        )}

        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {!showEdit && (
            <button
              className="btn-outline"
              style={{ fontSize: 11, padding: '4px 10px' }}
              onClick={() => setShowEdit(true)}
            >
              ✏ Edit
            </button>
          )}

          {showEdit && (
            <button
              className="btn-primary"
              style={{ fontSize: 11, padding: '4px 10px' }}
              onClick={handleEditSave}
            >
              Save
            </button>
          )}

          <button
            className="btn-success"
            style={{ fontSize: 11, padding: '4px 10px' }}
            onClick={handleConfirm}
          >
            ✓ Confirm
          </button>

          <button
            className="btn-danger"
            style={{ fontSize: 11, padding: '4px 10px' }}
            onClick={handleFlag}
          >
            ✗ Flag
          </button>
        </div>
      </div>

      {showNote && (
        <div onClick={e => e.stopPropagation()}>
          <textarea
            className="field-note-input"
            value={noteText}
            onChange={handleNoteChange}
            placeholder="Describe what's unclear or incorrect..."
            rows={2}
          />
        </div>
      )}
    </div>
  )
}

export default function Review() {
  const { id } = useParams()
  const navigate = useNavigate()

  const [submission, setSubmission] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [fieldStates, setFieldStates] = useState({})
  const [numPages, setNumPages] = useState(null)
  const [pageNumber, setPageNumber] = useState(1)
  const [pdfWidth, setPdfWidth] = useState(480)
  const rightPanelRef = useRef(null)

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

  useEffect(() => {
    function handleResize() {
      if (rightPanelRef.current) {
        setPdfWidth(rightPanelRef.current.offsetWidth - 32)
      }
    }
    handleResize()
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  const extractedFields = React.useMemo(() => {
    if (!submission?.extracted_fields) return []
    try {
      return typeof submission.extracted_fields === 'string'
        ? JSON.parse(submission.extracted_fields)
        : submission.extracted_fields
    } catch {
      return []
    }
  }, [submission])

  const reviewedCount = Object.keys(fieldStates).length
  const totalCount = extractedFields.length
  const allReviewed = reviewedCount === totalCount && totalCount > 0
  const progressPct = totalCount > 0 ? Math.round((reviewedCount / totalCount) * 100) : 0

  function handleConfirm(fieldKey, confirmedValue) {
    setFieldStates(prev => ({
      ...prev,
      [fieldKey]: { confirmed_value: confirmedValue, status: 'confirmed', partner_note: '' }
    }))
  }

  function handleFlag(fieldKey, confirmedValue, note) {
    setFieldStates(prev => ({
      ...prev,
      [fieldKey]: { confirmed_value: confirmedValue, status: 'flagged', partner_note: note || '' }
    }))
  }

  function handleFieldClick(pageNum) {
    if (pageNum && pageNum <= numPages) {
      setPageNumber(pageNum)
    }
  }

  async function handleContinue() {
    setSaving(true)
    setError('')
    try {
      const confirmedFields = extractedFields.map(f => {
        const state = fieldStates[f.field]
        return {
          field: f.field,
          label: f.label,
          confirmed_value: state?.confirmed_value ?? f.value ?? '',
          status: state?.status ?? 'confirmed',
          partner_note: state?.partner_note ?? ''
        }
      })
      await saveVerification(id, confirmedFields)
      navigate(`/responsibilities/${id}`)
    } catch (err) {
      setError(err.message)
      setSaving(false)
    }
  }

  function onDocumentLoadSuccess({ numPages }) {
    setNumPages(numPages)
  }

  if (loading) {
    return (
      <div className="loading-wrap" style={{ marginTop: 60 }}>
        <div className="spinner" />
        <p className="loading-text">Loading submission...</p>
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

  const pdfUrl = submission?.contract_filename
    ? `/uploads/${submission.contract_filename}`
    : null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 64px)' }}>
      <StepIndicator current={2} />

      {/* Progress + Continue bar */}
      <div style={{
        background: '#fff',
        borderBottom: '1px solid #e5e7eb',
        padding: '10px 20px',
        display: 'flex',
        alignItems: 'center',
        gap: 16
      }}>
        <div style={{ flex: 1 }}>
          <div className="progress-label">
            <span>{reviewedCount} of {totalCount} fields reviewed</span>
            <span>{progressPct}%</span>
          </div>
          <div className="progress-bar-bg">
            <div className="progress-bar-fill" style={{ width: `${progressPct}%` }} />
          </div>
        </div>

        {error && <div style={{ fontSize: 12, color: '#dc2626' }}>{error}</div>}

        <button
          className="btn-primary"
          onClick={handleContinue}
          disabled={!allReviewed || saving}
          style={{ flexShrink: 0 }}
        >
          {saving ? 'Saving...' : 'Continue to Sign →'}
        </button>
      </div>

      <div className="split-screen" style={{ flex: 1 }}>
        {/* Left panel: field cards */}
        <div className="left-panel">
          <div style={{ marginBottom: 12 }}>
            <h2 style={{ fontSize: 16, fontWeight: 700, color: '#1c3b60', marginBottom: 4 }}>
              Review Extracted Fields
            </h2>
            <p style={{ fontSize: 12, color: '#6b7280' }}>
              Click a field to jump to that page in the PDF. Confirm or flag each field to proceed.
            </p>
          </div>

          {extractedFields.length === 0 ? (
            <div className="alert-warning">No fields were extracted. The PDF may not be readable.</div>
          ) : (
            extractedFields.map(field => (
              <FieldCard
                key={field.field}
                field={field}
                fieldState={fieldStates[field.field]}
                onConfirm={handleConfirm}
                onFlag={handleFlag}
                onClick={handleFieldClick}
              />
            ))
          )}
        </div>

        {/* Right panel: PDF viewer */}
        <div className="right-panel" ref={rightPanelRef}>
          <div className="pdf-nav">
            <button
              onClick={() => setPageNumber(p => Math.max(1, p - 1))}
              disabled={pageNumber <= 1}
            >
              ← Prev
            </button>
            <span>Page {pageNumber} of {numPages || '?'}</span>
            <button
              onClick={() => setPageNumber(p => Math.min(numPages || 1, p + 1))}
              disabled={pageNumber >= (numPages || 1)}
            >
              Next →
            </button>
          </div>

          <div className="pdf-viewer-container">
            {pdfUrl ? (
              <Document
                file={pdfUrl}
                onLoadSuccess={onDocumentLoadSuccess}
                onLoadError={(err) => console.error('PDF load error:', err)}
                loading={
                  <div className="loading-wrap">
                    <div className="spinner" />
                    <p className="loading-text" style={{ color: '#9ca3af' }}>Loading PDF...</p>
                  </div>
                }
              >
                <Page
                  pageNumber={pageNumber}
                  width={pdfWidth}
                  renderTextLayer={true}
                  renderAnnotationLayer={true}
                />
              </Document>
            ) : (
              <div style={{ padding: 40, textAlign: 'center', color: '#9ca3af', fontSize: 14 }}>
                PDF not available
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
