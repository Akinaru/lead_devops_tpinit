const { PubSub } = require('@google-cloud/pubsub');
const { Storage } = require('@google-cloud/storage');
const axios = require('axios');
const archiver = require('archiver');
const photoModel = require('./photo_model');

// Initialisation globale (pour simuler une BDD)
global.zipJobs = global.zipJobs || {};

const pubsub = new PubSub({ projectId: 'ecni2-2026' });
const storage = new Storage();

// Le numéro étudiant
const i = process.env.STUDENT_NUMBER || '0';
const subscriptionName = `ecni2-${i}`;
const bucketName = 'ecni22026bucket';

async function processMessage(message) {
  try {
    const data = JSON.parse(message.data.toString());
    const tags = data.tags;
    console.log(`[Worker] Réception d'une demande de zip pour : ${tags}`);

    // 1. Appel API Flickr pour récupérer les 10 premières photos
    const photos = await photoModel.getFlickrPhotos(tags, 'all');
    const top10Photos = photos.slice(0, 10);

    if (top10Photos.length === 0) {
      console.log(`[Worker] Aucune photo trouvée pour ${tags}`);
      message.ack();
      return;
    }

    // 2. Création du flux ZIP
    const archive = archiver('zip', { zlib: { level: 9 } });

    // 3. Téléchargement des images et ajout dans le ZIP
    for (let index = 0; index < top10Photos.length; index++) {
      // On utilise media.m (image moyenne garantie d'exister) car media.b plante souvent en 502 sur Flickr
      const photoUrl = top10Photos[index].media.m;
      try {
        const response = await axios({
          method: 'GET',
          url: photoUrl,
          responseType: 'stream',
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' // Contournement CloudFront 502
          }
        });
        // Le nom du fichier dans le zip (ex: photo_0.jpg)
        archive.append(response.data, { name: `photo_${index}.jpg` });
      } catch (err) {
        console.error(`[Worker] Erreur téléchargement image : ${photoUrl}`);
      }
    }
    
    // On finalise le zip
    archive.finalize();

    // 4. Upload vers Google Cloud Storage
    const filename = `zip_${Date.now()}_${Math.floor(Math.random() * 1000)}.zip`;
    const bucket = storage.bucket(bucketName);
    // Le sujet précise 'public/users/' + filename
    const file = bucket.file(`public/users/${filename}`);

    const stream = file.createWriteStream({
      metadata: {
        contentType: 'application/zip',
        cacheControl: 'private'
      },
      resumable: false
    });

    archive.pipe(stream);

    stream.on('error', (err) => {
      console.error(`[Worker] Erreur upload Cloud Storage :`, err);
    });

    stream.on('finish', () => {
      console.log(`[Worker] Zip uploadé avec succès : ${filename}`);
      // On sauvegarde l'état "terminé" dans la variable globale (Clef: tags, Valeur: nom du fichier)
      global.zipJobs[tags] = filename;
    });

    // 5. Acknowledgment (on dit à Google Cloud qu'on a bien traité le message)
    message.ack();
    console.log(`[Worker] Message acquitté (ACK) pour ${tags}`);

  } catch (error) {
    console.error(`[Worker] Erreur générale lors du traitement du message :`, error);
    // En cas d'erreur, on n'acquitte pas le message pour qu'il soit re-distribué
    message.nack();
  }
}

function listenForMessages() {
  const subscription = pubsub.subscription(subscriptionName);
  console.log(`[Worker] En écoute sur la subscription : ${subscriptionName}...`);
  subscription.on('message', processMessage);
  subscription.on('error', error => {
    console.error(`[Worker] Erreur de subscription :`, error);
  });
}

// On démarre l'écoute
listenForMessages();
