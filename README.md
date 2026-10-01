# PixifyHQ

An AI logo and brand asset generator starter with Google sign-in, Firebase Realtime Database entitlements, Stripe Checkout, and a simulated asset preview.

## Project structure

```text
pixify-hq/
	client/
		src/App.jsx
		src/Dashboard.jsx
		src/firebase.js
		src/main.jsx
		src/styles.css
		.env.example
		package.json
		vite.config.js
	server/
		server.js
		.env.example
		database.rules.json
		package.json
	package.json
```

## Setup

1. Use Node.js 20 or newer and run `npm install` from the project root.
2. Copy `client/.env.example` to `client/.env`. Create a Firebase Web app in project `pixify-hq` and supply its Web API key and App ID. Enable Google as a sign-in provider and create a Realtime Database.
3. In Firebase Realtime Database, publish `server/database.rules.json`. The browser can read a user's own profile, but only the Admin SDK can create or change subscription and credit fields.
4. Copy `server/.env.example` to `server/.env`. Add a Stripe secret key, webhook signing secret, and recurring Price IDs for Starter ($9/month) and Pro ($29/month). Add a Firebase service account JSON to `FIREBASE_SERVICE_ACCOUNT_JSON`, or point `GOOGLE_APPLICATION_CREDENTIALS` to its file. Never place a service account or Stripe secret in the client.
5. In Stripe, configure a webhook to `http://localhost:4242/webhook` with `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`, and `invoice.paid`. For local testing, run `stripe listen --forward-to localhost:4242/webhook` and copy its signing secret into the server env file.
6. Add `http://localhost:5173` to Firebase Authentication's authorized domains.
7. Run `npm run dev`; Vite serves the app at `http://localhost:5173` and proxies `/api` to Express on port 4242.

## Production deployment

Firebase HTTPS Functions require the `pixify-hq` project to use the Blaze (pay-as-you-go) plan. The `pixifyApi` HTTPS Function is deployed in `us-central1`; Hosting rewrites `/api/**` and `/webhook` to it. For Stripe billing:

1. In Stripe, start in **test mode** and create two Products with recurring monthly prices: Starter at $9/month and Pro at $29/month. Copy each `price_...` ID.
2. In the project terminal, store the Stripe API secret, webhook signing secret, and Price IDs in Firebase Secret Manager. Each command prompts for its value; enter it directly in the terminal, never in chat or client files:

	```sh
	firebase functions:secrets:set STRIPE_SECRET_KEY --project pixify-hq
	firebase functions:secrets:set STRIPE_WEBHOOK_SECRET --project pixify-hq
	firebase functions:secrets:set STRIPE_STARTER_PRICE_ID --project pixify-hq
	firebase functions:secrets:set STRIPE_PRO_PRICE_ID --project pixify-hq
	```

	Use the test-mode `sk_test_...` API key initially. Price IDs are not passwords, but store them this way so the deployed function receives a single configuration path.
3. In Stripe Developers → Webhooks, add `https://pixify-hq.web.app/webhook` and subscribe to `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`, and `invoice.paid`. Reveal and copy its `whsec_...` signing secret directly into the `STRIPE_WEBHOOK_SECRET` prompt above.
4. Redeploy the function so it receives the newly configured secret versions:

	```sh
	firebase deploy --only functions:pixifyApi --project pixify-hq
	```

5. Test a checkout with a Stripe test card, confirm the webhook delivery succeeds, and verify the account becomes active with plan credits in Realtime Database. Switch to Stripe live mode only after testing; create live prices and repeat the secret/webhook setup with live credentials.

## Real image generation

The generator uses OpenAI's `gpt-image-1` API from the HTTPS Function. Add an OpenAI API key to Firebase Secret Manager without placing it in source or chat:

```sh
firebase functions:secrets:set OPENAI_API_KEY --project pixify-hq
firebase deploy --only functions:pixifyApi --project pixify-hq
```

The key needs access to image generation and the OpenAI project must have image API billing/quota available. Each successful generation stores a PNG in the user's Firebase Storage path and consumes one credit only after generation and storage succeed. Failed generation requests do not consume credits. Review OpenAI image pricing and Firebase Storage costs before allowing paid users to generate at scale; run one signed-in sandbox subscription test and one real image generation before launch.

## Realtime Database shape

```json
{
	"users": {
		"FIREBASE_UID": {
			"displayName": "Brand founder",
			"email": "founder@example.com",
			"subscriptionStatus": "inactive",
			"plan": null,
			"generationCredits": 0
		}
	}
}
```

New profiles are initialized by the authenticated `/api/profile` endpoint at sign-in, so accounts appear before checkout. Starter begins with 30 generation credits and Pro with 120. A successful renewal replenishes the plan's monthly allowance. The image-generation endpoint uses OpenAI and returns a downloadable PNG after a successful generation.

## Security notes

- Checkout and generation endpoints verify Firebase ID tokens with Firebase Admin.
- Prices are selected from server environment variables; the browser cannot supply an amount or Stripe Price ID.
- Stripe webhooks use the raw request body and verify `Stripe-Signature` before processing.
- Firebase Realtime Database rules deny all browser writes, so clients cannot grant themselves active status or credits.
- Configure Stripe's real HTTPS webhook endpoint and restrict Firebase/Stripe credentials appropriately before deployment.

## Admin account management

Set `ADMIN_EMAILS` in the server environment to a comma-separated list of trusted administrator email addresses, grant the Firebase Auth custom claim `{ "admin": true }`, or add `/admins/{uid}: true` using Firebase Admin SDK. The `admins` node is intentionally unreadable and unwritable to browser clients. Admins can open **Accounts & billing** in the signed-in dashboard to search users and inspect plan, subscription status, generation credits, latest recorded Stripe payment, and estimated monthly recurring revenue. The admin accounts endpoint enforces this access server-side. Latest payment information is recorded by the `invoice.paid` webhook; Stripe remains the authoritative source for billing and revenue reports.