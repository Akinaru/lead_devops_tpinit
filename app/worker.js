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
    
    console.log(`\n======================================================`);
    console.log(`[Worker/Consumer] Nouveau message reçu depuis la subscription Google Cloud Pub/Sub.`);
    console.log(`[Worker/Consumer] Payload (tags) : "${tags}"`);

    // 1. Appel API Flickr pour récupérer les 10 premières photos
    console.log(`[Worker/Consumer] Fetching API Flickr pour récupération des URLs d'images...`);
    const photos = await photoModel.getFlickrPhotos(tags, 'all');
    const top10Photos = photos.slice(0, 10);

    if (top10Photos.length === 0) {
      console.log(`[Worker/Consumer] Aucun résultat Flickr pour les tags spécifiés. Annulation du job.`);
      message.ack();
      return;
    }

    // 2. Création du flux ZIP
    console.log(`[Worker/Consumer] Initialisation du buffer de compression (Archiver stream)...`);
    const archive = archiver('zip', { zlib: { level: 9 } });

    // 3. Téléchargement des images et ajout dans le ZIP
    console.log(`[Worker/Consumer] Téléchargement asynchrone de ${top10Photos.length} images...`);
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
        archive.append(response.data, { name: `photo_${index}.jpg` });
      } catch (err) {
        console.error(`[Worker/Consumer] Échec du téléchargement du blob d'image : ${photoUrl}`);
      }
    }
    
    archive.finalize();

    // 4. Upload vers Google Cloud Storage
    const filename = `zip_${Date.now()}_${Math.floor(Math.random() * 1000)}.zip`;
    console.log(`[Worker/Consumer] Piping du stream ZIP vers Google Cloud Storage (Bucket: ${bucketName}, Fichier: ${filename})...`);
    
    const bucket = storage.bucket(bucketName);
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
      console.error(`[Worker/Consumer] Erreur I/O lors du writeStream GCS :`, err);
    });

    stream.on('finish', () => {
      console.log(`[Worker/Consumer] Upload GCS terminé avec succès.`);
      // Pédagogie : On stocke l'état de finalisation du job en mémoire globale pour que le Web Server (Producer) puisse l'interroger.
      // Dans une architecture micro-services réelle, on écrirait ce statut dans une base de données (ex: Redis ou PostgreSQL).
      global.zipJobs[tags] = filename;
    });

    // 5. Acknowledgment (on dit à Google Cloud qu'on a bien traité le message)
    message.ack();
    console.log(`[Worker/Consumer] Message Pub/Sub acquitté (ACK envoyé). Retrait de la file d'attente.`);
    console.log(`======================================================\n`);

  } catch (error) {
    console.error(`[Worker/Consumer] Exception critique lors du traitement du job :`, error);
    // NACK (Negative Acknowledgment) : demande à Pub/Sub de republier le message car il n'a pas pu être traité correctement.
    message.nack();
  }
}

function listenForMessages() {
  const subscription = pubsub.subscription(subscriptionName);
  console.log(`\n[Worker/Consumer] Initialisation réussie. En écoute (Polling) sur la subscription Pub/Sub : ${subscriptionName}`);
  subscription.on('message', processMessage);
  subscription.on('error', error => {
    console.error(`[Worker/Consumer] Erreur de connexion avec le service Pub/Sub :`, error);
  });
}

// On démarre l'écoute
listenForMessages();
