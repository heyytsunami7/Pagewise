import { create } from "zustand";
import {
    getAuth,
    onAuthStateChanged,
    createUserWithEmailAndPassword,
    signInWithEmailAndPassword,
    signInWithPopup,
    GoogleAuthProvider,
    signOut,
} from "firebase/auth";
import app from "../firebase/firebase.config";
import { apiFetch, setTokenGetter } from "../api/client";

const auth = getAuth(app);
const googleProvider = new GoogleAuthProvider();

let stopListening = null;

export const useAuthStore = create((set, get) => ({
    user: null, // the Firebase user, or null when logged out
    isAdmin: false, // from the server's /me, never guessed in the browser
    loading: true, // true until Firebase has reported and /me has answered

    // Call once at startup. Returns a function that stops listening.
    init() {
        if (stopListening) return stopListening;
        const stop = onAuthStateChanged(auth, async (user) => {
            if (!user) {
                set({ user: null, isAdmin: false, loading: false });
                return;
            }
            set({ user, loading: true });
            let isAdmin = false;
            try {
                const me = await apiFetch("/me");
                isAdmin = me.isAdmin === true;
            } catch {
                // The API is down or rejected us: stay logged in, just not as an admin.
            }
            // Ignore the answer if the user logged out or changed while we waited.
            if (get().user?.uid === user.uid) set({ isAdmin, loading: false });
        });
        stopListening = () => {
            stop();
            stopListening = null;
        };
        return stopListening;
    },

    login: (email, password) => signInWithEmailAndPassword(auth, email, password),
    signup: (email, password) => createUserWithEmailAndPassword(auth, email, password),
    loginWithGoogle: () => signInWithPopup(auth, googleProvider),
    logout: () => signOut(auth),

    // The current user's Firebase ID token, or null when logged out.
    getToken: async () => (auth.currentUser ? auth.currentUser.getIdToken() : null),
}));

// Every apiFetch call now carries the logged-in user's token.
setTokenGetter(() => useAuthStore.getState().getToken());