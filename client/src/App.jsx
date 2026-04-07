import React from 'react'
import { BrowserRouter, Routes, Route, Navigate, Link } from 'react-router-dom'
import Upload from './pages/Upload'
import Review from './pages/Review'
import Responsibilities from './pages/Responsibilities'
import Sign from './pages/Sign'
import Complete from './pages/Complete'
import Dashboard from './pages/Dashboard'

function Header() {
  return (
    <header className="app-header">
      <div className="header-brand">
        <img
          src="/brand-1.png"
          alt="Commercient"
          className="header-logo"
        />
        <span className="header-title">Partner Scope Verification Tool</span>
      </div>
      <nav className="header-nav">
        <Link to="/upload">New Submission</Link>
        <Link to="/dashboard">PAM Dashboard</Link>
      </nav>
    </header>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <Header />
      <Routes>
        <Route path="/" element={<Navigate to="/upload" replace />} />
        <Route path="/upload" element={<Upload />} />
        <Route path="/review/:id" element={<Review />} />
        <Route path="/responsibilities/:id" element={<Responsibilities />} />
        <Route path="/sign/:id" element={<Sign />} />
        <Route path="/complete/:id" element={<Complete />} />
        <Route path="/dashboard" element={<Dashboard />} />
      </Routes>
    </BrowserRouter>
  )
}
