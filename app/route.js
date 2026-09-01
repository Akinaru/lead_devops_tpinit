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
    const zipping = req.query.zipping === 'true'; // Indique si une tâche est en cours en arrière-plan

    const ejsLocalVariables = {
      tagsParameter: tags || '',
      tagmodeParameter: tagmode || '',
      zipping: zipping, // On passe l'info à la vue (pour afficher un message d'attente)
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
    // PÉDAGOGIE : Quand l'utilisateur rafraîchit la page, on vérifie si notre "Worker"
    // a fini son travail en arrière-plan. Si oui, il a mis le nom du fichier dans global.zipJobs.
    if (tags && global.zipJobs && global.zipJobs[tags]) {
      try {
        const filename = global.zipJobs[tags];
        const options = {
          action: 'read',
          expires: Date.now() + (2 * 24 * 60 * 60 * 1000) // Lien valide pendant 2 jours
        }; 
        
        // On demande à Google Cloud Storage un lien de téléchargement "Signé" (sécurisé)
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

  // --- ETAPE 2 : LE PRODUCER (L'envoyeur de message) ---
  app.post('/zip', async (req, res) => {
    const tags = req.query.tags;
    const tagmode = req.query.tagmode || 'all'; 
    
    if (!tags) {
      return res.status(400).send('Les tags sont requis pour zipper les résultats.');
    }

    const i = process.env.STUDENT_NUMBER || '0';
    const topicName = `ecni2-${i}`;

    try {
      console.log(`\n======================================================`);
      console.log(`📨 [Serveur Web - Producer] L'utilisateur a cliqué sur ZIP !`);
      console.log(`📨 [Serveur Web - Producer] Le serveur web ne va PAS zipper lui-même (ça prendrait trop de temps).`);
      
      const dataBuffer = Buffer.from(JSON.stringify({ tags: tags }));
      
      // PÉDAGOGIE : C'est ici toute la magie de l'asynchrone !
      // On dépose juste un petit "ticket" dans la boîte aux lettres Google (Pub/Sub)
      // et on répond immédiatement à l'utilisateur, sans attendre que le ZIP soit fini.
      const messageId = await pubsub.topic(topicName).publishMessage({ data: dataBuffer });
      console.log(`📨 [Serveur Web - Producer] Ticket déposé dans la file d'attente (Topic: ${topicName}). Message ID: ${messageId}`);
      console.log(`📨 [Serveur Web - Producer] Je réponds immédiatement à l'utilisateur pour ne pas bloquer sa page.`);
      console.log(`======================================================\n`);
      
      // On redirige vers l'accueil en ajoutant zipping=true pour afficher un message visuel sympa
      res.redirect(`/?tags=${tags}&tagmode=${tagmode}&zipping=true`);
    } catch (error) {
      console.error(`❌ [Serveur Web] Erreur lors de l'envoi au Pub/Sub :`, error);
      res.status(500).send('Erreur lors de la mise en file d\'attente du zippage.');
    }
  });
}

module.exports = route;
