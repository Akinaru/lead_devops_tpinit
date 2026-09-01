const formValidator = require('./form_validator');
const photoModel = require('./photo_model');
const { PubSub } = require('@google-cloud/pubsub');

// On instancie le client PubSub avec l'ID du projet Google Cloud fourni
const pubsub = new PubSub({ projectId: 'ecni2-2026' });

const { Storage } = require('@google-cloud/storage');
const storage = new Storage();

function route(app) {
  app.get('/', async (req, res) => {
    const tags = req.query.tags;
    const tagmode = req.query.tagmode;

    const ejsLocalVariables = {
      tagsParameter: tags || '',
      tagmodeParameter: tagmode || '',
      photos: [],
      searchResults: false,
      invalidParameters: false,
      zipDownloadUrl: null // On prépare la variable pour le lien de téléchargement
    };

    if (!tags && !tagmode) {
      return res.render('index', ejsLocalVariables);
    }

    if (!formValidator.hasValidFlickrAPIParams(tags, tagmode)) {
      ejsLocalVariables.invalidParameters = true;
      return res.render('index', ejsLocalVariables);
    }

    // --- ETAPE 5: Récupération du lien du fichier téléchargé ---
    // Si on a les tags et qu'un fichier zip est enregistré dans la variable globale (le Worker a fini)
    if (tags && global.zipJobs && global.zipJobs[tags]) {
      try {
        const filename = global.zipJobs[tags];
        const options = {
          action: 'read',
          // Expire dans 2 jours
          expires: Date.now() + (2 * 24 * 60 * 60 * 1000)
        }; 
        const [signedUrl] = await storage
         .bucket(process.env.STORAGE_BUCKET || 'ecni22026bucket')
         .file(`public/users/${filename}`)
         .getSignedUrl(options);
         
        ejsLocalVariables.zipDownloadUrl = signedUrl;
      } catch (error) {
        console.error("Erreur lors de la génération de l'URL signée:", error);
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
        console.log('Erreur récupération photos Flickr:', error)
        return res.status(500).send({ error });
      });
  });

  // --- ETAPE 2 : LE PRODUCER ---
  // Nouvel endpoint pour gérer le zippage
  app.post('/zip', async (req, res) => {
    const tags = req.query.tags;
    const tagmode = req.query.tagmode || 'all'; // On récupère aussi le tagmode
    
    if (!tags) {
      return res.status(400).send('Les tags sont requis pour zipper les résultats.');
    }

    // Le topic est sous la forme ecni2-i. Il faut récupérer le i depuis les variables d'environnement.
    // Si pas défini, on mettra 0 par défaut pour éviter que ça plante.
    const i = process.env.STUDENT_NUMBER || '0';
    const topicName = `ecni2-${i}`;

    try {
      // On prépare le message (en JSON, converti en Buffer)
      const dataBuffer = Buffer.from(JSON.stringify({ tags: tags }));
      
      // On publie (publish) le message dans la file d'attente (le Topic)
      const messageId = await pubsub.topic(topicName).publishMessage({ data: dataBuffer });
      console.log(`Message ${messageId} envoyé au topic ${topicName} pour les tags : ${tags}`);
      
      // On redirige l'utilisateur vers l'accueil (en gardant les paramètres intacts)
      res.redirect(`/?tags=${tags}&tagmode=${tagmode}`);
    } catch (error) {
      console.error(`Erreur lors de l'envoi au Pub/Sub :`, error);
      res.status(500).send('Erreur lors de la mise en file d\'attente du zippage.');
    }
  });
}

module.exports = route;
