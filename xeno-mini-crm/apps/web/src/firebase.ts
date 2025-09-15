import { initializeApp } from 'firebase/app'
import { getAuth, GoogleAuthProvider } from 'firebase/auth'

const firebaseConfig = {
	apiKey: import.meta.env.VITE_FB_API_KEY,
	authDomain: import.meta.env.VITE_FB_AUTH_DOMAIN,
	projectId: import.meta.env.VITE_FB_PROJECT_ID,
	appId: import.meta.env.VITE_FB_APP_ID,
	messagingSenderId: import.meta.env.VITE_FB_MESSAGING_SENDER_ID,
}

// Basic runtime validation to help diagnose invalid/missing keys during local dev
const missing = [
	['VITE_FB_API_KEY', firebaseConfig.apiKey],
	['VITE_FB_AUTH_DOMAIN', firebaseConfig.authDomain],
	['VITE_FB_PROJECT_ID', firebaseConfig.projectId],
	['VITE_FB_APP_ID', firebaseConfig.appId],
	['VITE_FB_MESSAGING_SENDER_ID', firebaseConfig.messagingSenderId],
].filter(([_, v]) => !v)

if (missing.length) {
	// eslint-disable-next-line no-console
	console.error('Missing Firebase env vars:', missing.map(([k]) => k).join(', '))
}

export const firebaseApp = initializeApp(firebaseConfig)
export const auth = getAuth(firebaseApp)
export const googleProvider = new GoogleAuthProvider() 