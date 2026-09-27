// firebase-config.js
// This connects our app to our Firebase project

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyC7mrZjwflW-r9c9BTBPcwYNTR7MnCIELm",
  authDomain: "noclass-mits.firebaseapp.com",
  projectId: "noclass-mits",
  storageBucket: "noclass-mits.firebasestorage.app",
  messagingSenderId: "827529495814",
  appId: "1:827529495814:web:03b6eb14d3c37fd6d0ca87"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);