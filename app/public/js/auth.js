const firebaseConfig = {
  apiKey: "AIzaSyCIvTlTGG115yaWDeFqxi-Jc2oYH45FlME",
  authDomain: "ecni2-2026.firebaseapp.com",
  databaseURL: "https://ecni2-2026-default-rtdb.firebaseio.com",
  projectId: "ecni2-2026",
  storageBucket: "ecni2-2026.firebasestorage.app",
  messagingSenderId: "1046535202867",
  appId: "1:1046535202867:web:a23b26f739647f87221b46"
};

firebase.initializeApp(firebaseConfig);
const provider = new firebase.auth.GoogleAuthProvider();
const auth = firebase.auth();

document.addEventListener('DOMContentLoaded', () => {
  const loginBtn = document.getElementById('login-btn');
  const logoutBtn = document.getElementById('logout-btn');
  const appContainer = document.getElementById('app-container');
  const userInfo = document.getElementById('user-info');
  const userName = document.getElementById('user-name');

  if (loginBtn) loginBtn.addEventListener('click', () => auth.signInWithPopup(provider));
  if (logoutBtn) logoutBtn.addEventListener('click', () => auth.signOut());

  auth.onAuthStateChanged((user) => {
    if (user) {
      if (loginBtn) loginBtn.style.display = 'none';
      if (userInfo) userInfo.style.display = 'block';
      if (userName) userName.textContent = user.displayName || user.email;
      if (appContainer) appContainer.style.display = 'block';
    } else {
      if (loginBtn) loginBtn.style.display = 'inline-block';
      if (userInfo) userInfo.style.display = 'none';
      if (appContainer) appContainer.style.display = 'none';
    }
  });
});
