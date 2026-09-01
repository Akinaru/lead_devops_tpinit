require('dotenv').config();
const express = require('express');
const favicon = require('serve-favicon');
const path = require('path');

const app = express();

// public assets
app.use(express.static(path.join(__dirname, 'public')));
app.use(favicon(path.join(__dirname, 'public/images', 'favicon.ico')));
app.use('/coverage', express.static(path.join(__dirname, '..', 'coverage')));

// ejs for view templates
app.engine('.html', require('ejs').__express);
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'html');

// load route
require('./route')(app);

// server
const port = process.env.PORT || 3005;
app.server = app.listen(port);
console.log(`listening on port ${port}`);

// --- ETAPE 3: Démarrage du Worker ---
// On importe le worker pour qu'il commence à écouter les messages dès le lancement du serveur
require('./worker');

module.exports = app;
