const BASE = '/api'

export async function uploadContract(formData) {
  const res = await fetch(`${BASE}/upload`, { method: 'POST', body: formData })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

export async function getSubmission(id) {
  const res = await fetch(`${BASE}/submissions/${id}`)
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

export async function saveVerification(id, confirmedFields) {
  const res = await fetch(`${BASE}/verify/${id}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ confirmed_fields: confirmedFields })
  })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

export async function signSubmission(id, data) {
  const res = await fetch(`${BASE}/sign/${id}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

export async function getSubmissions(password) {
  const res = await fetch(`${BASE}/submissions?password=${encodeURIComponent(password)}`)
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}
