import React from 'react';
import ReactDOM from 'react-dom/client';
import './styles.css';

function App() {
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <h1>Collision Shop</h1>
        <nav>
          <button>Dashboard</button>
          <button>Customers</button>
          <button>Claims</button>
          <button>Estimates</button>
          <button>Jobs</button>
          <button>Documents</button>
          <button>Reports</button>
        </nav>
      </aside>

      <main className="main-panel">
        <header className="topbar">
          <div>
            <p className="eyebrow">Operations</p>
            <h2>Shop Dashboard</h2>
          </div>
          <button className="primary-btn">New Claim</button>
        </header>

        <section className="stats-grid">
          <div className="stat-card">
            <label>Open Jobs</label>
            <strong>24</strong>
          </div>
          <div className="stat-card">
            <label>Inspections</label>
            <strong>8</strong>
          </div>
          <div className="stat-card">
            <label>Income</label>
            <strong>$48,200</strong>
          </div>
          <div className="stat-card">
            <label>Expenses</label>
            <strong>$18,760</strong>
          </div>
        </section>

        <section className="content-grid">
          <div className="panel">
            <h3>Upcoming Inspections</h3>
            <ul>
              <li>2026-09-18 — Tesla Model Y — State Farm</li>
              <li>2026-09-19 — Ford F-150 — GEICO</li>
              <li>2026-09-20 — Honda CR-V — Allstate</li>
            </ul>
          </div>

          <div className="panel">
            <h3>Follow-Up Needed</h3>
            <ul>
              <li>Call customer for final approval</li>
              <li>Upload police report scan</li>
              <li>Get signed repair authorization</li>
            </ul>
          </div>
        </section>
      </main>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
