const { PubSub } = require('@google-cloud/pubsub');
const { Storage } = require('@google-cloud/storage');
const formValidator = require('./form_validator');
const photoModel = require('./photo_model');
const { db } = require('./firebase');
const pubsub = new PubSub({ projectId: 'ecni2-2026' });
const storage = new Storage();

function route(app) {
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
      } catch (error) {}
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

  // NOUVELLE ROUTE : Historique
  app.get('/historique', async (req, res) => {
    try {
      const firstname = process.env.FIRSTNAME || 'maxime';
      const snapshot = await db.ref(`/${firstname}`).once('value');
      const jobs = snapshot.val();
      
      const historyList = [];
      if (jobs) {
        for (const [timestamp, jobData] of Object.entries(jobs)) {
          // Génération d'une URL signée pour chaque fichier de l'historique
          const options = {
            action: 'read',
            expires: Date.now() + (2 * 24 * 60 * 60 * 1000)
          };
          let signedUrl = null;
          try {
            const [url] = await storage
             .bucket(process.env.STORAGE_BUCKET || 'ecni22026bucket')
             .file(`public/users/${jobData.filename}`)
             .getSignedUrl(options);
            signedUrl = url;
          } catch(e) {}

          historyList.push({
            date: new Date(parseInt(timestamp)).toLocaleString('fr-FR'),
            tags: jobData.tags,
            filename: jobData.filename,
            url: signedUrl
          });
        }
      }
      
      // On trie du plus récent au plus ancien
      historyList.sort((a, b) => new Date(b.date) - new Date(a.date));
      
      res.render('historique', { historyList });
    } catch (error) {
      console.error(error);
      res.status(500).send("Erreur lors de la récupération de l'historique");
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
