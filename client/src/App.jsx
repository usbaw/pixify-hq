import { useEffect, useState } from 'react';
import { onAuthStateChanged, signInWithPopup, signOut } from 'firebase/auth';
import { ArrowDown, ArrowRight, Check, ChevronDown, CircleHelp, Gem, LoaderCircle, LogOut, Menu, Sparkles, WandSparkles, X } from 'lucide-react';
import AdminDashboard from './AdminDashboard.jsx';
import Dashboard from './Dashboard.jsx';
import { readApiResponse } from './api.js';
import { auth, database, firebaseConfigError, firebaseReady, googleProvider } from './firebase.js';
import './auth.css';

const plans = [
  { id: 'starter', name: 'Starter', price: '$9', credits: '30 generations / month', description: 'For a new idea finding its shape.', features: ['Logo concepts in 4 styles', 'Full brand color palette', 'Social profile assets', 'Commercial usage rights'] },
  { id: 'pro', name: 'Pro', price: '$29', credits: '120 generations / month', description: 'For the brand ready to take off.', features: ['Everything in Starter', 'More room to explore', 'Priority rendering', 'Complete launch asset kit'], featured: true },
];

function GoogleMark() {
  return <svg aria-hidden="true" viewBox="0 0 48 48" className="google-mark"><path fill="#4285F4" d="M43.6 24.5c0-1.4-.1-2.8-.4-4.1H24v7.8h11a9.4 9.4 0 0 1-4 6.2v5.1h6.5c3.8-3.5 6.1-8.7 6.1-15Z"/><path fill="#34A853" d="M24 44c5.5 0 10.1-1.8 13.5-4.8L31 34.1c-1.8 1.2-4.1 1.9-7 1.9-5.3 0-9.8-3.6-11.4-8.5H6v5.3A20 20 0 0 0 24 44Z"/><path fill="#FBBC05" d="M12.6 27.5a12 12 0 0 1 0-7v-5.3H6a20 20 0 0 0 0 17.6l6.6-5.3Z"/><path fill="#EA4335" d="M24 12c3 0 5.7 1 7.8 3.1l5.8-5.8C34.1 5.9 29.5 4 24 4A20 20 0 0 0 6 15.2l6.6 5.3C14.2 15.6 18.7 12 24 12Z"/></svg>;
}

export default function App() {
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [adminView, setAdminView] = useState(false);
  const [authBusy, setAuthBusy] = useState(false);
  const [checkoutPlan, setCheckoutPlan] = useState('');
  const [pendingCheckoutPlan, setPendingCheckoutPlan] = useState('');
  const [confirmingPayment, setConfirmingPayment] = useState(false);
  const [checkoutSessionId, setCheckoutSessionId] = useState('');
  const [notice, setNotice] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    if (!auth) {
      setAuthLoading(false);
      return undefined;
    }
    return onAuthStateChanged(auth, async (nextUser) => {
      setUser(nextUser);
      setAdminView(false);
      if (nextUser) {
        try {
          const token = await nextUser.getIdToken();
          const profileResponse = await fetch('/api/profile', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({}),
          });
          await readApiResponse(profileResponse, 'Profile setup');
          const response = await fetch('/api/admin/access', { headers: { Authorization: `Bearer ${token}` } });
          const payload = await readApiResponse(response, 'Admin access check');
          setIsAdmin(payload.isAdmin === true);
        } catch {
          setIsAdmin(false);
        }
      } else {
        setIsAdmin(false);
      }
      setAuthLoading(false);
    });
  }, []);

  useEffect(() => {
    if (!user || !pendingCheckoutPlan) return;
    const planToCheckout = pendingCheckoutPlan;
    setPendingCheckoutPlan('');
    startCheckout(planToCheckout);
  }, [user, pendingCheckoutPlan]);

  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    const result = query.get('checkout');
    const sessionId = query.get('session_id');
    if (result === 'success' && sessionId) {
      setCheckoutSessionId(sessionId);
      setConfirmingPayment(true);
    }
    else if (result === 'success') setNotice('Payment returned from Stripe. Sign in with the same account to confirm your plan.');
    if (result === 'cancelled') setNotice('Checkout was cancelled. Your plans are still here when you need them.');
    if (result) {
      query.delete('checkout');
      query.delete('session_id');
      const remainingQuery = query.toString();
      window.history.replaceState({}, '', `${window.location.pathname}${remainingQuery ? `?${remainingQuery}` : ''}${window.location.hash}`);
    }
  }, []);

  useEffect(() => {
    if (!user || !confirmingPayment) return undefined;
    let cancelled = false;
    async function confirmPayment() {
      if (!checkoutSessionId) {
        setConfirmingPayment(false);
        return;
      }
      try {
        const token = await user.getIdToken();
        const response = await fetch('/api/confirm-checkout-session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ sessionId: checkoutSessionId }),
        });
        const payload = await readApiResponse(response, 'Payment confirmation');
        if (!cancelled) setNotice(payload.confirmed ? `${payload.profile.plan === 'pro' ? 'Pro' : 'Starter'} plan active. ${payload.profile.generationCredits} generations are ready.` : 'Payment is being confirmed. Refresh shortly.');
      } catch (error) {
        if (!cancelled) setNotice(error.message || 'Payment confirmation failed. Contact support if your card was charged.');
      } finally {
        if (!cancelled) setConfirmingPayment(false);
      }
    }
    confirmPayment();
    return () => { cancelled = true; };
  }, [user, confirmingPayment, checkoutSessionId]);

  async function login() {
    if (!auth) {
      setNotice(firebaseConfigError || 'Firebase is not configured yet.');
      return;
    }
    setAuthBusy(true);
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (error) {
      setPendingCheckoutPlan('');
      setNotice(error.code === 'auth/popup-closed-by-user' ? 'Sign-in was closed before it finished.' : error.message || 'Google sign-in failed.');
    } finally {
      setAuthBusy(false);
    }
  }

  async function startCheckout(planId) {
    if (!user) {
      setPendingCheckoutPlan(planId);
      await login();
      return;
    }
    setCheckoutPlan(planId);
    setNotice('');
    try {
      const token = await user.getIdToken();
      const response = await fetch('/api/create-checkout-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ plan: planId }),
      });
      const payload = await readApiResponse(response, 'Plan checkout');
      window.location.assign(payload.url);
    } catch (error) {
      setNotice(error.message || 'Unable to start checkout.');
      setCheckoutPlan('');
    }
  }

  if (authLoading) return <main className="boot-screen"><span className="boot-mark"><Sparkles size={19} /></span><span>Opening your studio</span></main>;
  if (user && adminView && isAdmin) return <AdminDashboard user={user} onBack={() => setAdminView(false)} onSignOut={() => signOut(auth)} />;
  if (user) return <Dashboard user={user} database={database} onSignOut={() => signOut(auth)} onCheckout={startCheckout} checkoutPlan={checkoutPlan} notice={notice} onDismissNotice={() => setNotice('')} isAdmin={isAdmin} onOpenAdmin={() => setAdminView(true)} />;

  return (
    <main className="landing-shell">
      <div className="announcement"><span className="announcement-dot" /> YOUR NEXT BIG IDEA, VISUALLY SPEAKING <ArrowRight size={13} /></div>
      <header className="site-header">
        <a className="wordmark" href="#top" aria-label="PixifyHQ home"><span className="brand-glyph"><Sparkles size={18} strokeWidth={2.4} /></span><span>pixify<span className="wordmark-light">hq</span></span></a>
        <nav className={menuOpen ? 'main-nav nav-open' : 'main-nav'}>
          <a href="#how">The process</a><a href="#pricing">Pricing</a><a href="#faq">FAQ</a>
        </nav>
        <div className="header-actions">
          <button className="button button-quiet header-login" onClick={login} disabled={authBusy}>{authBusy ? 'One moment…' : 'Sign in'}</button>
          <button className="button button-dark header-cta" onClick={login} disabled={authBusy}>{authBusy ? <LoaderCircle className="spin" size={16} /> : <>Create account <ArrowRight size={15} /></>}</button>
        </div>
        <button className="mobile-menu icon-button" aria-label={menuOpen ? 'Close navigation' : 'Open navigation'} onClick={() => setMenuOpen(!menuOpen)}>{menuOpen ? <X size={20} /> : <Menu size={20} />}</button>
      </header>

      {notice && <div className="toast"><span>{notice}</span><button aria-label="Dismiss notification" onClick={() => setNotice('')}><X size={16} /></button></div>}
      {!firebaseReady && <div className="setup-banner"><CircleHelp size={16} /> {firebaseConfigError}</div>}

      <section className="hero" id="top">
        <div className="hero-copy">
          <div className="eyebrow"><span className="eyebrow-line" /> BRANDING FOR THE BRAVE-ENOUGH-TO-BEGIN</div>
          <h1>Make a little<br />more <span>you.</span></h1>
          <p className="hero-description">A logo, a look, a feeling. Build the beginnings of a brand that feels like it was always yours.</p>
          <div className="hero-actions"><button className="button button-coral hero-cta" onClick={login} disabled={authBusy}>{authBusy ? <LoaderCircle className="spin" size={17} /> : <>Continue with Google <ArrowRight size={16} /></>}</button><a className="text-link" href="#how">See how it works <ArrowDown size={15} /></a></div>
          <p className="auth-hint">New to PixifyHQ? Your Google account creates your account automatically.</p>
          <div className="social-proof"><div className="avatar-stack"><span>AL</span><span>MK</span><span>JR</span><span>TS</span></div><div><div className="proof-stars">★★★★★</div><span>Made for 12,000+ big beginnings</span></div></div>
        </div>
        <div className="hero-art" aria-label="Brand identity preview for Sunday Supply">
          <div className="art-orbit orbit-one" /><div className="art-orbit orbit-two" />
          <div className="art-card art-main"><div className="art-topline"><span>BRAND STUDY — 001</span><span>01 / 04</span></div><div className="sun-mark"><span /><span /><span /><span /><span /><span /><span /><span /></div><div className="art-brand-name">sunday<br /><i>supply</i></div><div className="art-footer"><span>THE SLOW DOWN CLUB</span><span>EST. 2025</span></div></div>
          <div className="swatch-note"><span className="swatch swatch-coral" /><span className="swatch swatch-sun" /><span className="swatch swatch-green" /><span className="swatch swatch-ink" /><small>A feeling, in color.</small></div>
          <div className="type-note"><span>TYPE / 02</span><strong>Sunday<br /><em>made easy.</em></strong><small>Soft, warm &amp; a little unexpected</small></div>
          <div className="sparkle-stamp"><Sparkles size={20} /></div>
          <div className="caption-tab"><span className="caption-dot" /> YOUR BRAND, TAKING SHAPE</div>
        </div>
      </section>

      <div className="ticker" aria-label="A good brand feels like you"><div className="ticker-track">A GOOD BRAND FEELS LIKE YOU <span>✳</span> A GOOD BRAND FEELS LIKE YOU <span>✳</span> A GOOD BRAND FEELS LIKE YOU <span>✳</span> A GOOD BRAND FEELS LIKE YOU <span>✳</span></div></div>

      <section className="process-section" id="how"><div className="section-heading"><div><div className="eyebrow"><span className="eyebrow-line" /> YOUR IDEA, MEET YOUR LOOK</div><h2>From “what if”<br />to <span>oh, that’s it.</span></h2></div><p>No design degree. No blank-canvas panic. Just a few little choices that make your big idea look like itself.</p></div>
        <div className="process-grid"><article className="process-item"><span className="step-number">01</span><div className="step-visual step-visual-one"><span className="mini-window"><i /><i /><i /><b>Sunday Supply</b><small>Slow-made everyday things</small><span className="mini-pill">warm &amp; handmade <Sparkles size={11} /></span></span></div><h3>Tell us the feeling</h3><p>Your name, your world, and the words that make it yours.</p></article><article className="process-item"><span className="step-number">02</span><div className="step-visual step-visual-two"><span className="style-chip style-chip-one">SOFT / ORGANIC</span><span className="style-chip style-chip-two">BOLD / MODERN</span><span className="style-chip style-chip-three">PLAYFUL / BRIGHT</span><WandSparkles className="style-spark" size={29} /></div><h3>Follow your eye</h3><p>Pick a visual direction. We’ll make it feel like you.</p></article><article className="process-item"><span className="step-number">03</span><div className="step-visual step-visual-three"><div className="tiny-brand"><div className="tiny-sun">✳</div><strong>good things<br /><i>grow here</i></strong><div><span /><span /><span /><span /></div></div></div><h3>Meet your new brand</h3><p>A logo and a whole little world, ready to go places.</p></article></div>
      </section>

      <section className="pricing-section" id="pricing"><div className="pricing-heading"><div className="eyebrow"><span className="eyebrow-line" /> SMALL PRICE, BIG BRAND ENERGY</div><h2>Pick your pace.</h2><p>Keep exploring for as long as your idea needs.</p></div><div className="pricing-grid">{plans.map((plan) => <article className={`price-card ${plan.featured ? 'price-card-featured' : ''}`} key={plan.id}><div className="price-card-top"><div><h3>{plan.name}</h3><p>{plan.description}</p></div>{plan.featured && <span className="popular-label">FOR THE BIG LEAP</span>}</div><div className="price-line"><strong>{plan.price}</strong><span>/ month</span></div><div className="credit-line"><Gem size={15} /> {plan.credits}</div><button className={`button ${plan.featured ? 'button-coral' : 'button-dark'} plan-button`} onClick={() => startCheckout(plan.id)} disabled={checkoutPlan === plan.id}>{checkoutPlan === plan.id ? <LoaderCircle size={17} className="spin" /> : <>Choose {plan.name} <ArrowRight size={15} /></>}</button><ul>{plan.features.map((feature) => <li key={feature}><Check size={15} />{feature}</li>)}</ul></article>)}</div><div className="pricing-note">Cancel whenever. Keep making things that feel like you. <a href="#faq">The fine print <ArrowRight size={13} /></a></div></section>

      <section className="closing-section"><div className="closing-star">✳</div><div className="closing-copy"><div className="eyebrow"><span className="eyebrow-line" /> THERE’S A BRAND IN THERE</div><h2>Let it <i>out.</i></h2><button className="button button-paper" onClick={login}>Continue with Google <ArrowRight size={15} /></button></div><div className="closing-sticker">A good<br />thing starts<br /><i>somewhere.</i></div></section>

      <footer className="site-footer" id="faq"><a className="wordmark footer-wordmark" href="#top"><span className="brand-glyph"><Sparkles size={17} /></span><span>pixify<span className="wordmark-light">hq</span></span></a><span>Made for the thing you can’t stop thinking about.</span><a href="mailto:hello@pixifyhq.example">Need a hand? <ArrowRight size={13} /></a><small>© 2025 PixifyHQ</small></footer>
    </main>
  );
}
