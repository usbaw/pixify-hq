import { useEffect, useState } from 'react';
import { onValue, ref } from 'firebase/database';
import { ArrowLeft, ArrowRight, Check, Download, Gem, LoaderCircle, LogOut, Sparkles, WandSparkles } from 'lucide-react';
import { readApiResponse } from './api.js';
import './generator.css';

const styles = [
  { id: 'playful', name: 'Playful & bright', tone: 'A little loud, a lot of lovely' },
  { id: 'minimal', name: 'Modern minimal', tone: 'Clear lines, quiet confidence' },
  { id: 'organic', name: 'Soft & organic', tone: 'Grounded, warm, human' },
  { id: 'classic', name: 'Classic & bold', tone: 'Made to be remembered' },
];

export default function Dashboard({ user, database, onSignOut, onCheckout, checkoutPlan, notice, onDismissNotice, isAdmin, onOpenAdmin }) {
  const [profile, setProfile] = useState(null);
  const [profileLoading, setProfileLoading] = useState(Boolean(database));
  const [brandName, setBrandName] = useState('');
  const [style, setStyle] = useState('playful');
  const [generating, setGenerating] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!database) {
      setProfileLoading(false);
      return undefined;
    }
    return onValue(ref(database, `users/${user.uid}`), (snapshot) => {
      setProfile(snapshot.val() || { subscriptionStatus: 'inactive', generationCredits: 0 });
      setProfileLoading(false);
    }, () => {
      setError('Could not read your studio profile. Check the Realtime Database rules and try again.');
      setProfileLoading(false);
    });
  }, [database, user.uid]);

  const active = profile?.subscriptionStatus === 'active';
  const credits = Number(profile?.generationCredits || 0);

  async function generate(event) {
    event.preventDefault();
    setError('');
    setResult(null);
    if (!brandName.trim()) {
      setError('Give your brand a name first.');
      return;
    }
    if (!active) {
      setError('Your studio is waiting for a plan. Pick one below to get started.');
      return;
    }
    setGenerating(true);
    try {
      const token = await user.getIdToken();
      const response = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ brandName: brandName.trim(), style }),
      });
      const payload = await readApiResponse(response, 'Asset generation');
      setResult(payload.asset);
    } catch (requestError) {
      setError(requestError.message || 'Your concept could not be created.');
    } finally {
      setGenerating(false);
    }
  }

  const titleName = profile?.displayName?.split(' ')[0] || user.displayName?.split(' ')[0] || 'there';

  return (
    <main className="studio-shell">
      <header className="studio-header"><a className="wordmark" href="/" aria-label="PixifyHQ home"><span className="brand-glyph"><Sparkles size={18} /></span><span>pixify<span className="wordmark-light">hq</span></span></a><div className="studio-header-right"><a className="back-link" href="/"><ArrowLeft size={14} /> Home</a><span className="studio-divider" /><div className="user-chip"><span className="user-avatar">{(user.displayName || user.email || 'P').slice(0, 1).toUpperCase()}</span><span>{titleName}</span></div><button className="icon-button logout-button" aria-label="Sign out" title="Sign out" onClick={onSignOut}><LogOut size={17} /></button></div></header>
      <div className="studio-layout"><aside className="studio-sidebar"><div className="sidebar-caption">YOUR SPACE</div><div className="sidebar-active"><span className="sidebar-active-icon"><WandSparkles size={17} /></span><span>Brand studio</span><span className="sidebar-live" /></div>{isAdmin && <button className="sidebar-admin-link" onClick={onOpenAdmin}><Gem size={15} /> <span>Accounts &amp; billing</span><ArrowRight size={13} /></button>}<div className="sidebar-caption sidebar-caption-lower">ACCOUNT</div><div className="sidebar-account"><span className="account-plan-icon"><Gem size={15} /></span><div><small>YOUR PLAN</small><strong>{profileLoading ? 'Checking…' : active ? `${capitalize(profile?.plan || 'Starter')} plan` : 'No active plan'}</strong></div></div><div className="credit-card"><div className="credit-card-header"><span>GENERATIONS</span><Gem size={15} /></div><strong>{profileLoading ? '—' : active ? credits : '0'}<small> credits left</small></strong><div className="credit-bar"><span style={{ width: `${active ? Math.min(100, credits / (profile?.plan === 'pro' ? 120 : 30) * 100) : 0}%` }} /></div><button onClick={() => onCheckout('pro')} disabled={checkoutPlan === 'pro'}>{checkoutPlan === 'pro' ? 'Opening checkout…' : active ? 'Need more? Upgrade' : 'Choose a plan'} <ArrowRight size={12} /></button></div><div className="sidebar-foot"><span className="sidebar-foot-dot" /> All your good ideas, in one place.</div></aside>
        <section className="studio-main"><div className="studio-welcome"><div><div className="eyebrow"><span className="eyebrow-line" /> YOUR BRAND STARTS HERE</div><h1>Good morning, {titleName}.</h1><p>What are we making today?</p></div><span className="welcome-stamp">✳</span></div>
          {notice && <div className="inline-notice"><Check size={15} />{notice}<button aria-label="Dismiss notification" onClick={onDismissNotice}>×</button></div>}
          <div className="builder-grid"><section className="builder-panel"><div className="panel-heading"><div><span className="panel-kicker">THE BRAND BUILDER</span><h2>Give it a look.</h2></div><span className="panel-step">01 <i>/</i> 03</span></div><form onSubmit={generate}><label className="field-label" htmlFor="brand-name">What’s your brand called?</label><input id="brand-name" className="text-input" type="text" placeholder="e.g. Sunday Supply" maxLength={60} value={brandName} onChange={(event) => setBrandName(event.target.value)} autoComplete="organization" /><div className="input-meta"><span>The name you’re building around.</span><span>{brandName.length}/60</span></div><label className="field-label style-label" htmlFor="brand-style">Pick a starting feeling</label><div className="select-wrap"><select id="brand-style" className="text-input style-select" value={style} onChange={(event) => setStyle(event.target.value)}>{styles.map((option) => <option key={option.id} value={option.id}>{option.name} — {option.tone}</option>)}</select><span className="select-caret">⌄</span></div>
              {!active && !profileLoading && <div className="upgrade-callout"><span className="upgrade-icon"><Gem size={16} /></span><div><strong>Your brand studio is one little step away.</strong><span>Choose a plan to unlock monthly generations.</span></div><button type="button" onClick={() => onCheckout('starter')} disabled={checkoutPlan === 'starter'}>{checkoutPlan === 'starter' ? <LoaderCircle size={15} className="spin" /> : <>Explore plans <ArrowRight size={14} /></>}</button></div>}
              {error && <p className="form-error" role="alert">{error}</p>}
              <button className="button button-coral generate-button" type="submit" disabled={generating || profileLoading || (active && credits < 1)}>{generating ? <><LoaderCircle size={16} className="spin" /> Finding your look…</> : <><Sparkles size={16} /> Generate an asset <ArrowRight size={15} /></>}</button><p className="generation-note">{active ? `${credits} generations left this month` : 'A good idea deserves a good beginning.'}</p></form></section>
              <section className={`preview-panel ${result ? 'preview-panel-result' : ''}`}><div className="preview-header"><span>YOUR CANVAS</span><span>{generating ? 'IN THE MAKING' : result ? 'JUST MADE' : 'READY WHEN YOU ARE'}</span></div><div className="preview-canvas">{generating ? <div className="render-state"><div className="render-spinner"><span /><span /><span /></div><span>Finding your visual identity</span><small>Creating your logo concept…</small></div> : result ? <div className="generated-image-wrap"><img className="generated-image" src={result.previewUrl} alt={`Generated logo concept for ${result.brandName}`} /><a className="download-asset" href={result.downloadUrl} download><Download size={14} /> Download PNG</a></div> : <div className="empty-state"><div className="empty-sparkle"><Sparkles size={22} /></div><span>Your canvas is clear.</span><small>A good place for something new.</small><div className="empty-baseline"><i /><i /><i /></div></div>}</div><div className="preview-footer"><span>{result ? `Logo concept for ${result.brandName}` : 'Your first concept will show up here'}</span>{result && <span className="mock-badge"><Check size={12} /> GENERATED</span>}</div></section></div>
          <div className="studio-bottom"><span><Sparkles size={14} /> Made for exploring. Your next idea might be the one.</span><a href="mailto:hello@pixifyhq.example">Need a hand? <ArrowRight size={13} /></a></div>
        </section></div>
    </main>
  );
}

function capitalize(value) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
