import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';
import { getDatabase } from 'firebase/database';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  databaseURL: import.meta.env.VITE_FIREBASE_DATABASE_URL,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || 'pixify-hq',
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

const missingConfig = ['apiKey', 'authDomain', 'databaseURL', 'appId'].filter(
  (key) => !firebaseConfig[key],
);

export const firebaseReady = missingConfig.length === 0;
export const firebaseConfigError = firebaseReady
  ? ''
  : `Add ${missingConfig.map((key) => `VITE_FIREBASE_${key.replace(/[A-Z]/g, (letter) => `_${letter}`).toUpperCase()}`).join(', ')} to client/.env.`;

const app = firebaseReady ? initializeApp(firebaseConfig) : null;
export const auth = app ? getAuth(app) : null;
export const database = app ? getDatabase(app) : null;
export const googleProvider = new GoogleAuthProvider();
