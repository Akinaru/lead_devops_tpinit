const { PubSub } = require('@google-cloud/pubsub');
const { Storage } = require('@google-cloud/storage');
const { db } = require('./firebase');
const axios = require('axios');
const archiver = require('archiver');
const photoModel = require('./photo_model');

const pubsub = new PubSub({ projectId: 'ecni2-2026' });
const storage = new Storage();

const i = process.env.STUDENT_NUMBER || '0';
const subscriptionName = `ecni2-${i}`;
const bucketName = 'ecni22026bucket';

async function processMessage(message) {
  const data = JSON.parse(message.data.toString());
  const tags = data.tags;

  const photos = await photoModel.getFlickrPhotos(tags, 'all');
  const top10Photos = photos.slice(0, 10);

  const archive = archiver('zip', { zlib: { level: 9 } });

  const filename = `zip_${Date.now()}_${Math.floor(Math.random() * 1000)}.zip`;
  const file = storage.bucket(bucketName).file(`public/users/${filename}`);

  const stream = file.createWriteStream({
    metadata: { contentType: 'application/zip', cacheControl: 'private' },
    resumable: false
  });

  archive.pipe(stream);

  stream.on('finish', async () => {
    const firstname = process.env.FIRSTNAME || 'maxime';
    const timeOfZipping = Date.now();
    
    await db.ref(`/${firstname}/${timeOfZipping}`).set({
      filename: filename,
      tags: tags
    });
    
    message.ack();
  });

  for (let index = 0; index < top10Photos.length; index++) {
    const photoUrl = top10Photos[index].media.m;
    try {
      const response = await axios({
        method: 'GET',
        url: photoUrl,
        responseType: 'stream',
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
      });
      archive.append(response.data, { name: `photo_${index}.jpg` });
    } catch(e) {}
  }

  archive.finalize();
}

function listen() {
  pubsub.subscription(subscriptionName).on('message', processMessage);
}

listen();
