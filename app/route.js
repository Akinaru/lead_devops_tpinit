const formValidator = require('./form_validator');
const photoModel = require('./photo_model');

const { PubSub } = require('@google-cloud/pubsub');
const pubsub = new PubSub({ projectId: 'ecni2-2026' });

const { Storage } = require('@google-cloud/storage');
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

    if (tags && global.zipJobs && global.zipJobs[tags]) {
      try {
        const filename = global.zipJobs[tags];
        const options = {
          action: 'read',
          expires: Date.now() + (2 * 24 * 60 * 60 * 1000) // Lien valide pendant 2 jours
        };

        const [signedUrl] = await storage
          .bucket(process.env.STORAGE_BUCKET || 'ecni22026bucket')
          .file(`public/users/${filename}`)
          .getSignedUrl(options);

        ejsLocalVariables.zipDownloadUrl = signedUrl;
      } catch (error) {
        console.error("❌ [Serveur Web] Erreur lors de la génération de l'URL signée:", error);
      }
    }

    return photoModel
      .getFlickrPhotos(tags, tagmode)
      .then(photos => {
        ejsLocalVariables.photos = photos;
        ejsLocalVariables.searchResults = true;
        return res.render('index', ejsLocalVariables);
      })
      .catch(error => {
        console.log('❌ [Serveur Web] Erreur récupération photos Flickr:', error)
        return res.status(500).send({ error });
      });
  });

  app.post('/zip', async (req, res) => {
    const tags = req.query.tags;
    const tagmode = req.query.tagmode || 'all';

    if (!tags) {
      return res.status(400).send('Les tags sont requis pour zipper les résultats.');
    }

    const i = process.env.STUDENT_NUMBER || '0';
    const topicName = `ecni2-${i}`;

    try {
      const dataBuffer = Buffer.from(JSON.stringify({ tags: tags }));
      const messageId = await pubsub.topic(topicName).publishMessage({ data: dataBuffer });
      res.redirect(`/?tags=${tags}&tagmode=${tagmode}&zipping=true`);
    } catch (error) {
      console.error(`❌ [Serveur Web] Erreur lors de l'envoi au Pub/Sub :`, error);
      res.status(500).send('Erreur lors de la mise en file d\'attente du zippage.');
    }
  });
}

module.exports = route;
