import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ArrowRight, Building2, CircleDollarSign, LoaderCircle, LogOut, RefreshCw, Search, ShieldCheck, Users } from 'lucide-react';
import { readApiResponse } from './api.js';
import './admin.css';

const planPrices = { starter: 9, pro: 29 };

export default function AdminDashboard({ user, onBack, onSignOut }) {
  const [accounts, setAccounts] = useState([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  async function loadAccounts() {
    setLoading(true);
    setError('');
    try {
      const token = await user.getIdToken();
      const response = await fetch('/api/admin/accounts', { headers: { Authorization: `Bearer ${token}` } });
      const payload = await readApiResponse(response, 'Account management');
      setAccounts(payload.accounts || []);
    } catch (requestError) {
      setError(requestError.message || 'Could not load accounts.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadAccounts(); }, []);

  const filteredAccounts = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return accounts;
    return accounts.filter((account) => `${account.displayName} ${account.email} ${account.plan || ''} ${account.uid}`.toLowerCase().includes(normalizedQuery));
  }, [accounts, query]);

  const activeAccounts = accounts.filter((account) => account.subscriptionStatus === 'active');
  const estimatedMrr = activeAccounts.reduce((total, account) => total + (planPrices[account.plan] || 0), 0);

  return (
    <main className="admin-shell">
      <header className="studio-header"><a className="wordmark" href="/" aria-label="PixifyHQ home"><span className="brand-glyph"><ShieldCheck size={18} /></span><span>pixify<span className="wordmark-light">hq</span></span></a><div className="studio-header-right"><button className="back-link admin-back" onClick={onBack}><ArrowLeft size={14} /> Brand studio</button><span className="studio-divider" /><div className="user-chip"><span className="user-avatar">{(user.displayName || user.email || 'A').slice(0, 1).toUpperCase()}</span><span>Admin</span></div><button className="icon-button logout-button" aria-label="Sign out" title="Sign out" onClick={onSignOut}><LogOut size={17} /></button></div></header>
      <section className="admin-content">
        <div className="admin-title-row"><div><div className="eyebrow"><span className="eyebrow-line" /> ACCOUNT MANAGEMENT</div><h1>Customers &amp; billing</h1><p>Account access, subscription status, and recorded Stripe payments.</p></div><button className="admin-refresh" onClick={loadAccounts} disabled={loading}><RefreshCw size={15} className={loading ? 'spin' : ''} /> Refresh</button></div>
        {error && <div className="admin-error" role="alert">{error}</div>}
        <div className="admin-stats"><article><span><Users size={16} /> TOTAL ACCOUNTS</span><strong>{loading ? '—' : accounts.length}</strong></article><article><span><Building2 size={16} /> ACTIVE PLANS</span><strong>{loading ? '—' : activeAccounts.length}</strong></article><article><span><CircleDollarSign size={16} /> EST. MONTHLY REVENUE</span><strong>{loading ? '—' : formatCurrency(estimatedMrr * 100, 'usd')}<small> / month</small></strong></article></div>
        <section className="accounts-panel"><header className="accounts-panel-header"><div><h2>All accounts</h2><span>{loading ? 'Loading customer records…' : `${filteredAccounts.length} of ${accounts.length} accounts`}</span></div><label className="account-search"><Search size={15} /><input aria-label="Search accounts" placeholder="Search name, email, plan…" value={query} onChange={(event) => setQuery(event.target.value)} /></label></header>
          <div className="accounts-table-wrap"><table className="accounts-table"><thead><tr><th>ACCOUNT</th><th>PLAN</th><th>STATUS</th><th>CREDITS</th><th>LATEST PAYMENT</th><th>JOINED</th></tr></thead><tbody>{loading ? <tr><td colSpan="6" className="table-empty"><LoaderCircle size={17} className="spin" /> Loading accounts</td></tr> : filteredAccounts.length ? filteredAccounts.map((account) => <tr key={account.uid}><td><strong>{account.displayName || 'Unnamed account'}</strong><small>{account.email || account.uid}</small></td><td>{account.plan ? <span className="plan-tag">{capitalize(account.plan)}</span> : <span className="muted-cell">—</span>}</td><td><span className={`status-tag ${account.subscriptionStatus === 'active' ? 'status-active' : 'status-inactive'}`}><i />{capitalize(account.subscriptionStatus || 'inactive')}</span></td><td>{account.generationCredits}</td><td>{account.billing?.latestAmountPaidCents != null ? <><strong>{formatCurrency(account.billing.latestAmountPaidCents, account.billing.currency)}</strong><small>{formatDate(account.billing.paidAt)}</small></> : <span className="muted-cell">No payment recorded</span>}</td><td>{formatDate(account.createdAt)}</td></tr>) : <tr><td colSpan="6" className="table-empty">{query ? 'No accounts match that search.' : 'No customer accounts yet.'}</td></tr>}</tbody></table></div>
        </section>
        <div className="admin-footnote"><ShieldCheck size={14} /> Customer list is visible only to authorized administrators. Revenue is estimated from active plan prices; check Stripe for authoritative financial reporting.</div>
        <button className="admin-back-mobile" onClick={onBack}>Return to brand studio <ArrowRight size={14} /></button>
      </section>
    </main>
  );
}

function capitalize(value) { return value.charAt(0).toUpperCase() + value.slice(1); }
function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(date);
}
function formatCurrency(amount, currency = 'usd') {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: currency.toUpperCase() }).format((Number(amount) || 0) / 100);
}