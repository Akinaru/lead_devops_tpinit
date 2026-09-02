const { PubSub } = require('@google-cloud/pubsub');
const { Storage } = require('@google-cloud/storage');
const formValidator = require('./form_validator');
const photoModel = require('./photo_model');
const { db } = require('./firebase');
const tokenBucketMiddleware = require('./rate_limiter');
const pubsub = new PubSub({ projectId: 'ecni2-2026' });
const storage = new Storage();

function route(app) {
  app.use(tokenBucketMiddleware);

  app.get('/', async (req, res) => {
    const tags = req.query.tags;
    const tagmode = req.query.tagmode;
    const zipping = req.query.zipping === 'true';

    const ejsLocalVariables = {
      tagsParameter: tags || '',
      tagmodeParameter: tagmode || '',
      zipping: zipping,
      photos: [],
      searchResults: false,
      invalidParameters: false,
      zipDownloadUrl: null
    };

    if (!tags && !tagmode) {
      return res.render('index', ejsLocalVariables);
    }

    if (!formValidator.hasValidFlickrAPIParams(tags, tagmode)) {
      ejsLocalVariables.invalidParameters = true;
      return res.render('index', ejsLocalVariables);
    }

    if (tags) {
      try {
        const firstname = process.env.FIRSTNAME || 'maxime';
        const snapshot = await db.ref(`/${firstname}`).once('value');
        const jobs = snapshot.val();

        let foundFilename = null;
        if (jobs) {
          for (const key in jobs) {
            if (jobs[key].tags === tags) {
              foundFilename = jobs[key].filename;
            }
          }
        }

        if (foundFilename) {
          const options = {
            action: 'read',
            expires: Date.now() + (2 * 24 * 60 * 60 * 1000)
          };
          const [signedUrl] = await storage
            .bucket(process.env.STORAGE_BUCKET || 'ecni22026bucket')
            .file(`public/users/${foundFilename}`)
            .getSignedUrl(options);

          ejsLocalVariables.zipDownloadUrl = signedUrl;
        }
      } catch (error) { }
    }

    return photoModel
      .getFlickrPhotos(tags, tagmode)
      .then(photos => {
        ejsLocalVariables.photos = photos;
        ejsLocalVariables.searchResults = true;
        return res.render('index', ejsLocalVariables);
      })
      .catch(error => {
        return res.status(500).send({ error });
      });
  });

  // ROUTE HISTORIQUE (Vue principale - Affichage Dossiers)
  app.get('/historique', (req, res) => {
    // On ne charge plus la BDD côté serveur, on renvoie juste la page HTML
    res.render('historique');
  });

  // API : Récupère uniquement la liste des dossiers (Créateurs) sans télécharger les 15 Mo de données
  app.get('/api/users', async (req, res) => {
    try {
      // Pour appeler l'API REST Firebase, on a besoin de s'authentifier avec le token "Admin"
      const { getApp } = require('firebase-admin/app');
      const credential = getApp().options.credential;
      const tokenObj = await credential.getAccessToken();
      const accessToken = tokenObj.access_token;

      // Astuce Firebase : Le paramètre REST "?shallow=true" permet de ne récupérer QUE les clés
      const axios = require('axios');
      const response = await axios.get(`https://ecni2-2026-default-rtdb.firebaseio.com/.json?shallow=true&access_token=${accessToken}`);
      const users = Object.keys(response.data || {});
      res.json(users);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // API : Récupère le contenu d'un dossier précis, de façon limitée
  app.get('/api/users/:name', async (req, res) => {
    try {
      const uploader = req.params.name;
      // On limite aux 50 dernières entrées pour éviter de crasher sur les stress-tests
      const snapshot = await db.ref(`/${uploader}`).orderByKey().limitToLast(50).once('value');
      const userJobs = snapshot.val();

      const historyList = [];

      async function processJob(timestampKey, jobData) {
        if (!jobData || !jobData.filename) return;

        const options = { action: 'read', expires: Date.now() + (2 * 24 * 60 * 60 * 1000) };
        let signedUrl = null;
        try {
          const [url] = await storage.bucket(process.env.STORAGE_BUCKET || 'ecni22026bucket').file(`public/users/${jobData.filename}`).getSignedUrl(options);
          signedUrl = url;
        } catch (e) { }

        let num = parseInt(timestampKey);
        if (num < 10000000000) num *= 1000;
        let dateObj = jobData.createdAt ? new Date(jobData.createdAt) : new Date(num);
        let dateAffichee = isNaN(dateObj.getTime()) ? "Date inconnue" : dateObj.toLocaleString('fr-FR');

        historyList.push({
          dateStr: dateAffichee,
          dateObj: isNaN(dateObj.getTime()) ? 0 : dateObj.getTime(),
          tags: jobData.tags || 'Inconnu',
          filename: jobData.filename,
          url: signedUrl
        });
      }

      if (userJobs) {
        for (const [level1Key, level1Value] of Object.entries(userJobs)) {
          if (typeof level1Value !== 'object' || !level1Value) continue;
          if (level1Value.filename) {
            await processJob(level1Key, level1Value);
          } else {
            for (const [level2Key, level2Value] of Object.entries(level1Value)) {
              if (typeof level2Value === 'object' && level2Value && level2Value.filename) {
                await processJob(level1Key, level2Value);
              }
            }
          }
        }
      }

      historyList.sort((a, b) => b.dateObj - a.dateObj);
      res.json(historyList);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // ROUTE DE DEBUG (Droits Admin)
  app.get('/api/debug', async (req, res) => {
    try {
      // Le Firebase Admin SDK a tous les droits, il contourne la permission_denied !
      const snapshot = await db.ref('/').once('value');
      res.json(snapshot.val());
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post('/zip', async (req, res) => {
    const tags = req.query.tags;
    const tagmode = req.query.tagmode || 'all';
    if (!tags) return res.status(400).send('Tags required');

    const i = process.env.STUDENT_NUMBER || '0';
    const topicName = `ecni2-${i}`;

    try {
      const dataBuffer = Buffer.from(JSON.stringify({ tags: tags }));
      await pubsub.topic(topicName).publishMessage({ data: dataBuffer });
      res.redirect(`/?tags=${tags}&tagmode=${tagmode}&zipping=true`);
    } catch (error) {
      res.status(500).send('Error');
    }
  });
}

module.exports = route;
