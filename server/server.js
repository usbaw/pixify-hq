import 'dotenv/config';
import crypto from 'node:crypto';
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getDatabase } from 'firebase-admin/database';
import { getStorage } from 'firebase-admin/storage';
import express from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import Stripe from 'stripe';

const app = express();
const port = Number(process.env.PORT || 4242);
const clientUrl = process.env.CLIENT_URL || 'https://pixify-hq.web.app';
process.env.FIREBASE_DATABASE_URL ||= 'https://pixify-hq-default-rtdb.firebaseio.com';
const requiredEnv = ['FIREBASE_DATABASE_URL'];
const missingEnv = requiredEnv.filter((key) => !process.env[key]);

if (missingEnv.length) {
  console.error(`Missing required server environment values: ${missingEnv.join(', ')}`);
  process.exit(1);
}

const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT_JSON
  ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON)
  : undefined;

if (!getApps().length) {
  initializeApp({
    ...(serviceAccount ? { credential: cert(serviceAccount) } : {}),
    databaseURL: process.env.FIREBASE_DATABASE_URL,
    storageBucket: 'pixify-hq.firebasestorage.app',
  });
}

const database = getDatabase();
const auth = getAuth();
const storage = getStorage();
const creditsByPlan = { starter: 30, pro: 120 };

function stripeConfiguration() {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  return {
    stripe: secretKey ? new Stripe(secretKey) : null,
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
    priceByPlan: {
      starter: process.env.STRIPE_STARTER_PRICE_ID,
      pro: process.env.STRIPE_PRO_PRICE_ID,
    },
  };
}

app.disable('x-powered-by');
app.use(helmet());
app.use((request, response, next) => {
  const origin = request.get('origin');
  if (!origin || origin === clientUrl) {
    response.setHeader('Access-Control-Allow-Origin', origin || clientUrl);
    response.setHeader('Vary', 'Origin');
    response.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  }
  if (request.method === 'OPTIONS') return response.sendStatus(origin && origin !== clientUrl ? 403 : 204);
  return next();
});

const apiLimiter = rateLimit({ windowMs: 60_000, limit: 30, standardHeaders: 'draft-8', legacyHeaders: false });
const checkoutLimiter = rateLimit({ windowMs: 60_000, limit: 5, standardHeaders: 'draft-8', legacyHeaders: false });

function asyncRoute(handler) {
  return (request, response, next) => Promise.resolve(handler(request, response, next)).catch(next);
}

async function requireFirebaseUser(request, response, next) {
  const [scheme, token] = (request.get('authorization') || '').split(' ');
  if (scheme !== 'Bearer' || !token) return response.status(401).json({ error: 'Sign in to continue.' });
  try {
    request.user = await auth.verifyIdToken(token);
    return next();
  } catch {
    return response.status(401).json({ error: 'Your sign-in has expired. Please sign in again.' });
  }
}

async function isAdminUser(user) {
  const adminEmails = (process.env.ADMIN_EMAILS || '')
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
  const email = user.email?.toLowerCase();
  if (user.admin === true || (email && adminEmails.includes(email))) return true;
  const adminRecord = await database.ref(`admins/${user.uid}`).once('value');
  return adminRecord.val() === true;
}

function requireAdmin(request, response, next) {
  return isAdminUser(request.user)
    .then((isAdmin) => isAdmin ? next() : response.status(403).json({ error: 'Admin access is required.' }))
    .catch(next);
}

function planFromPrice(priceId) {
  const { priceByPlan } = stripeConfiguration();
  return Object.entries(priceByPlan).find(([, configuredPrice]) => configuredPrice === priceId)?.[0] || null;
}

async function setSubscription(uid, subscription, statusOverride) {
  const status = statusOverride || subscription.status;
  const plan = planFromPrice(subscription.items.data[0]?.price.id);
  const updates = {
    subscriptionStatus: status === 'active' || status === 'trialing' ? 'active' : 'inactive',
    stripeSubscriptionId: subscription.id,
    stripeCustomerId: typeof subscription.customer === 'string' ? subscription.customer : subscription.customer.id,
    updatedAt: Date.now(),
  };
  if (plan) updates.plan = plan;
  if (updates.subscriptionStatus === 'inactive') updates.generationCredits = 0;
  await database.ref(`users/${uid}`).update(updates);
}

app.get('/api/health', (_request, response) => response.json({ status: 'ok' }));

app.get('/api/admin/access', apiLimiter, requireFirebaseUser, asyncRoute(async (request, response) => {
  return response.json({ isAdmin: await isAdminUser(request.user) });
}));

app.get('/api/admin/accounts', apiLimiter, requireFirebaseUser, requireAdmin, asyncRoute(async (_request, response) => {
  const [authUsers, profilesSnapshot] = await Promise.all([
    (async () => {
      const users = [];
      let pageToken;
      do {
        const page = await auth.listUsers(1000, pageToken);
        users.push(...page.users);
        pageToken = page.pageToken;
      } while (pageToken);
      return users;
    })(),
    database.ref('users').once('value'),
  ]);
  const profiles = profilesSnapshot.val() || {};
  const accounts = authUsers.map((user) => {
    const profile = profiles[user.uid] || {};
    return {
      uid: user.uid,
      displayName: profile.displayName || user.displayName || '',
      email: profile.email || user.email || '',
      createdAt: user.metadata.creationTime || null,
      lastSignInAt: user.metadata.lastSignInTime || null,
      subscriptionStatus: profile.subscriptionStatus || 'inactive',
      plan: profile.plan || null,
      generationCredits: Number(profile.generationCredits || 0),
      billing: profile.billing || null,
    };
  });
  accounts.sort((first, second) => (second.createdAt || '').localeCompare(first.createdAt || ''));
  return response.json({ accounts, total: accounts.length });
}));

app.post('/api/profile', apiLimiter, requireFirebaseUser, express.json({ limit: '10kb' }), asyncRoute(async (request, response) => {
  const userRef = database.ref(`users/${request.user.uid}`);
  const transaction = await userRef.transaction((existing) => ({
    ...(existing || {}),
    displayName: request.user.name || existing?.displayName || '',
    email: request.user.email || existing?.email || '',
    photoURL: request.user.picture || existing?.photoURL || '',
    subscriptionStatus: existing?.subscriptionStatus || 'inactive',
    plan: existing?.plan || null,
    generationCredits: Number(existing?.generationCredits || 0),
    createdAt: existing?.createdAt || Date.now(),
    updatedAt: Date.now(),
  }));
  return response.json({ profile: transaction.snapshot.val() });
}));

app.post('/api/create-checkout-session', apiLimiter, requireFirebaseUser, checkoutLimiter, express.json({ limit: '10kb' }), asyncRoute(async (request, response) => {
  const { stripe, priceByPlan } = stripeConfiguration();
  if (!stripe) return response.status(503).json({ error: 'Checkout is not configured yet. Add the Stripe server secrets first.' });
  const plan = request.body?.plan;
  if (!Object.hasOwn(priceByPlan, plan) || !priceByPlan[plan]) {
    return response.status(400).json({ error: 'That plan is not available right now.' });
  }

  const userRef = database.ref(`users/${request.user.uid}`);
  const existing = (await userRef.once('value')).val() || {};
  if (existing.subscriptionStatus === 'active' && existing.plan === plan) {
    return response.status(409).json({ error: 'You already have this plan.' });
  }

  let session;
  try {
    session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price: priceByPlan[plan], quantity: 1 }],
      client_reference_id: request.user.uid,
      customer: existing.stripeCustomerId || undefined,
      customer_email: existing.stripeCustomerId ? undefined : request.user.email,
      metadata: { firebaseUid: request.user.uid, plan },
      subscription_data: { metadata: { firebaseUid: request.user.uid, plan } },
      success_url: `${clientUrl}/?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${clientUrl}/?checkout=cancelled#pricing`,
      allow_promotion_codes: true,
    });
  } catch (error) {
    console.error('Stripe Checkout session creation failed:', {
      type: error.type,
      code: error.code,
      statusCode: error.statusCode,
    });
    if (error.code === 'resource_missing' && error.param === 'line_items[0][price]') {
      return response.status(503).json({
        error: 'This plan price is not in the Stripe account connected to PixifyHQ. Use a test API key and plan Price IDs from the same Stripe sandbox account.',
      });
    }
    if (error.type === 'StripeAuthenticationError') {
      return response.status(503).json({ error: 'The connected Stripe test key was rejected. Update the server key in Firebase Secret Manager.' });
    }
    return response.status(502).json({ error: 'Stripe could not start checkout. Check the sandbox product and price configuration.' });
  }
  return response.json({ url: session.url });
}));

app.post('/api/confirm-checkout-session', apiLimiter, requireFirebaseUser, express.json({ limit: '10kb' }), asyncRoute(async (request, response) => {
  const { stripe } = stripeConfiguration();
  if (!stripe) return response.status(503).json({ error: 'Payment confirmation is not configured yet.' });

  const sessionId = typeof request.body?.sessionId === 'string' ? request.body.sessionId : '';
  if (!sessionId.startsWith('cs_')) return response.status(400).json({ error: 'A valid Checkout Session ID is required.' });

  let session;
  try {
    session = await stripe.checkout.sessions.retrieve(sessionId, { expand: ['subscription'] });
  } catch (error) {
    console.error('Stripe Checkout session verification failed:', { type: error.type, code: error.code, statusCode: error.statusCode });
    return response.status(404).json({ error: 'This Stripe Checkout session could not be found.' });
  }

  if (session.client_reference_id !== request.user.uid || session.metadata?.firebaseUid !== request.user.uid) {
    return response.status(403).json({ error: 'This Checkout Session does not belong to your account.' });
  }
  if (session.mode !== 'subscription' || session.payment_status !== 'paid') {
    return response.status(409).json({ error: 'Payment is not complete yet. Wait for Stripe to finish processing, then refresh.' });
  }

  const { priceByPlan } = stripeConfiguration();
  const subscription = session.subscription;
  if (!subscription || !['active', 'trialing'].includes(subscription.status)) {
    return response.status(409).json({ error: 'The subscription is not active yet.' });
  }

  const purchasedPriceId = subscription.items.data[0]?.price.id;
  const plan = Object.entries(priceByPlan).find(([, configuredPrice]) => configuredPrice === purchasedPriceId)?.[0];
  if (!plan) return response.status(409).json({ error: 'The purchased plan does not match the configured Stripe prices.' });

  const userRef = database.ref(`users/${request.user.uid}`);
  const transaction = await userRef.transaction((profile) => {
    const existing = profile || {};
    if (existing.confirmedCheckoutSessionId === session.id) return;
    return {
      ...existing,
      displayName: request.user.name || existing.displayName || '',
      email: request.user.email || existing.email || '',
      photoURL: request.user.picture || existing.photoURL || '',
      subscriptionStatus: 'active',
      plan,
      generationCredits: creditsByPlan[plan],
      stripeCustomerId: typeof session.customer === 'string' ? session.customer : session.customer?.id,
      stripeSubscriptionId: subscription.id,
      confirmedCheckoutSessionId: session.id,
      updatedAt: Date.now(),
      createdAt: existing.createdAt || Date.now(),
    };
  });

  const profile = transaction.snapshot.val();
  return response.json({
    confirmed: profile?.subscriptionStatus === 'active' && profile?.plan === plan,
    profile: {
      subscriptionStatus: profile?.subscriptionStatus,
      plan: profile?.plan,
      generationCredits: profile?.generationCredits,
    },
  });
}));

app.post('/api/generate', apiLimiter, requireFirebaseUser, express.json({ limit: '10kb' }), asyncRoute(async (request, response) => {
  const brandName = typeof request.body?.brandName === 'string' ? request.body.brandName.trim() : '';
  const style = request.body?.style;
  if (!brandName || brandName.length > 60) return response.status(400).json({ error: 'Brand name must be between 1 and 60 characters.' });
  if (!['playful', 'minimal', 'organic', 'classic'].includes(style)) return response.status(400).json({ error: 'Choose one of the available visual styles.' });
  const imageApiKey = process.env.OPENAI_API_KEY;
  if (!imageApiKey) return response.status(503).json({ error: 'Image generation is not configured yet. Add the OpenAI API key to Firebase Secret Manager.' });

  const userRef = database.ref(`users/${request.user.uid}`);
  const currentProfile = (await userRef.once('value')).val();
  if (currentProfile?.subscriptionStatus !== 'active') return response.status(403).json({ error: 'Choose an active plan before generating.' });
  if (Number(currentProfile.generationCredits) < 1) return response.status(402).json({ error: 'You are out of generations for this month.' });

  const styleDescriptions = {
    playful: 'playful, bright, friendly, rounded geometry and expressive but simple forms',
    minimal: 'modern minimal, clean geometric forms, excellent negative space and restrained detail',
    organic: 'soft organic, warm natural shapes, approachable hand-crafted feeling',
    classic: 'classic bold, confident timeless composition, strong simple silhouette',
  };
  let imageBytes;
  try {
    const imageResponse = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: { Authorization: `Bearer ${imageApiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-image-1',
        prompt: `Create a polished, original logo concept for the brand named "${brandName.replace(/["\\]/g, '')}". Art direction: ${styleDescriptions[style]}. Make a centered, professional brand mark with crisp shapes and a plain white background. Avoid mockups, product photography, watermarks, extra wording, and misspelled text. Prioritize the icon and visual identity over rendering the brand name as text.`,
        size: '1024x1024',
        quality: 'medium',
        output_format: 'png',
      }),
      signal: AbortSignal.timeout(90_000),
    });
    const result = await imageResponse.json();
    if (!imageResponse.ok) {
      console.error('OpenAI image generation failed:', { status: imageResponse.status, code: result.error?.code, type: result.error?.type });
      const status = imageResponse.status === 401 ? 503 : imageResponse.status === 429 ? 429 : 502;
      return response.status(status).json({ error: imageResponse.status === 401 ? 'The image-generation API key was rejected.' : imageResponse.status === 429 ? 'Image generation is busy or the API quota is exhausted. No credit was used.' : 'Image generation failed. No credit was used.' });
    }
    const encodedImage = result.data?.[0]?.b64_json;
    if (!encodedImage) return response.status(502).json({ error: 'The image service returned no image. No credit was used.' });
    imageBytes = Buffer.from(encodedImage, 'base64');
  } catch (error) {
    console.error('OpenAI image generation request failed:', { name: error.name, message: error.message });
    return response.status(502).json({ error: error.name === 'TimeoutError' ? 'Image generation timed out. No credit was used.' : 'Could not reach the image-generation service. No credit was used.' });
  }

  const assetId = crypto.randomUUID();
  const storagePath = `users/${request.user.uid}/assets/${assetId}.png`;
  const downloadToken = crypto.randomUUID();
  try {
    await storage.bucket().file(storagePath).save(imageBytes, {
      resumable: false,
      metadata: {
        contentType: 'image/png',
        cacheControl: 'private, max-age=3600',
        metadata: { firebaseStorageDownloadTokens: downloadToken },
      },
    });
  } catch (error) {
    console.error('Generated image storage failed:', { code: error.code, message: error.message });
    return response.status(502).json({ error: 'The logo was generated but could not be saved. No credit was used.' });
  }

  const encodedStoragePath = encodeURIComponent(storagePath);
  const downloadUrl = `https://firebasestorage.googleapis.com/v0/b/pixify-hq.firebasestorage.app/o/${encodedStoragePath}?alt=media&token=${downloadToken}`;

  const creditTransaction = await userRef.transaction((profile) => {
    if (!profile || profile.subscriptionStatus !== 'active' || Number(profile.generationCredits) < 1) return;
    profile.generationCredits -= 1;
    profile.updatedAt = Date.now();
    profile.assets ||= {};
    profile.assets[assetId] = { brandName, style, storagePath, createdAt: Date.now() };
    return profile;
  });
  if (!creditTransaction.committed) {
    await storage.bucket().file(storagePath).delete({ ignoreNotFound: true });
    return response.status(409).json({ error: 'Your plan or credits changed during generation. No credit was used; try again.' });
  }

  return response.json({
    asset: { id: assetId, brandName, style, type: 'logo', previewUrl: `data:image/png;base64,${imageBytes.toString('base64')}`, downloadUrl, createdAt: new Date().toISOString() },
    generationCredits: Number(creditTransaction.snapshot.val()?.generationCredits || 0),
  });
}));

// Keep Stripe's signature-verification route ahead of all JSON parsing middleware.
app.post('/webhook', express.raw({ type: 'application/json', limit: '1mb' }), asyncRoute(async (request, response) => {
  const { stripe, webhookSecret } = stripeConfiguration();
  if (!stripe || !webhookSecret) return response.status(503).send('Stripe webhooks are not configured.');
  const signature = request.get('stripe-signature');
  let event;
  try {
    event = stripe.webhooks.constructEvent(request.body, signature, webhookSecret);
  } catch (error) {
    console.warn(`Rejected Stripe webhook signature: ${error.message}`);
    return response.status(400).send('Invalid webhook signature.');
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        const uid = session.client_reference_id || session.metadata?.firebaseUid;
        if (!uid || session.mode !== 'subscription' || !session.subscription) break;
        const subscription = await stripe.subscriptions.retrieve(session.subscription);
        const plan = planFromPrice(subscription.items.data[0]?.price.id);
        if (!plan) {
          console.error(`Checkout completed with an unconfigured Stripe Price ID for user ${uid}.`);
          break;
        }
        await database.ref(`users/${uid}`).transaction((profile) => {
          const userProfile = profile || {};
          if (userProfile.checkoutSessionId === session.id) return;
          return {
            ...userProfile,
            subscriptionStatus: subscription.status === 'active' || subscription.status === 'trialing' ? 'active' : 'inactive',
            plan,
            generationCredits: creditsByPlan[plan],
            stripeCustomerId: typeof session.customer === 'string' ? session.customer : session.customer?.id,
            stripeSubscriptionId: subscription.id,
            checkoutSessionId: session.id,
            updatedAt: Date.now(),
          };
        });
        break;
      }
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        const subscription = event.data.object;
        const uid = subscription.metadata?.firebaseUid;
        if (uid) await setSubscription(uid, subscription, event.type === 'customer.subscription.deleted' ? 'canceled' : undefined);
        break;
      }
      case 'invoice.paid': {
        const invoice = event.data.object;
        if (invoice.subscription) {
          const subscription = await stripe.subscriptions.retrieve(invoice.subscription);
          const uid = subscription.metadata?.firebaseUid;
          const plan = planFromPrice(subscription.items.data[0]?.price.id);
          if (uid && plan && ['active', 'trialing'].includes(subscription.status)) {
            await database.ref(`users/${uid}`).update({
              generationCredits: creditsByPlan[plan],
              plan,
              subscriptionStatus: 'active',
              billing: {
                latestAmountPaidCents: invoice.amount_paid,
                currency: invoice.currency,
                invoiceStatus: invoice.status,
                paidAt: invoice.status_transitions?.paid_at ? invoice.status_transitions.paid_at * 1000 : Date.now(),
                invoiceId: invoice.id,
              },
              updatedAt: Date.now(),
            });
          }
        }
        break;
      }
      default:
        break;
    }
    return response.json({ received: true });
  } catch (error) {
    console.error(`Stripe event ${event.id} failed:`, error);
    return response.status(500).json({ error: 'Webhook processing failed.' });
  }
}));

app.use((error, _request, response, _next) => {
  console.error('Request failed:', error);
  if (response.headersSent) return;
  return response.status(500).json({ error: 'Something went wrong. Please try again.' });
});

if (process.env.FUNCTIONS_EMULATOR !== 'true' && process.env.K_SERVICE === undefined) {
  app.listen(port, () => console.log(`PixifyHQ API listening on http://localhost:${port}`));
}

export default app;