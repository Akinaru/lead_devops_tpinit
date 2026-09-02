const { initializeApp, getApps, applicationDefault } = require('firebase-admin/app');
const { getDatabase } = require('firebase-admin/database');

if (getApps().length === 0) {
  initializeApp({
    credential: applicationDefault(),
    databaseURL: 'https://ecni2-2026-default-rtdb.firebaseio.com'
  });
}

const db = getDatabase();

module.exports = { db };
