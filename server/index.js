import { onRequest } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import app from './server.js';

const stripeSecretKey = defineSecret('STRIPE_SECRET_KEY');
const stripeWebhookSecret = defineSecret('STRIPE_WEBHOOK_SECRET');
const starterPriceId = defineSecret('STRIPE_STARTER_PRICE_ID');
const proPriceId = defineSecret('STRIPE_PRO_PRICE_ID');
const openAiApiKey = defineSecret('OPENAI_API_KEY');

export const pixifyApi = onRequest({
	region: 'us-central1',
	secrets: [stripeSecretKey, stripeWebhookSecret, starterPriceId, proPriceId, openAiApiKey],
}, app);
