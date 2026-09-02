const { PubSub } = require('@google-cloud/pubsub');
const { Storage } = require('@google-cloud/storage');
const axios = require('axios');
const formValidator = require('./form_validator');
const photoModel = require('./photo_model');
const { db } = require('./firebase');
const rateLimiter = require('./rate_limiter');

const pubsub = new PubSub({ projectId: 'ecni2-2026' });
const storage = new Storage();

function route(app) {
  app.use(rateLimiter.middleware);

  app.get('/', async (req, res) => {
    const { tags, tagmode, zipping } = req.query;
    const locals = {
      tagsParameter: tags || '',
      tagmodeParameter: tagmode || '',
      zipping: zipping === 'true',
      photos: [],
      searchResults: false,
      invalidParameters: false,
      zipDownloadUrl: null
    };

    if (!tags && !tagmode) return res.render('index', locals);
    
    if (!formValidator.hasValidFlickrAPIParams(tags, tagmode)) {
      locals.invalidParameters = true;
      return res.render('index', locals);
    }

    try {
      const firstname = process.env.FIRSTNAME || 'maxime';
      const jobs = (await db.ref(`/${firstname}`).once('value')).val();
      
      let foundFile = null;
      if (jobs) {
        for (const key in jobs) {
          if (jobs[key].tags === tags) foundFile = jobs[key].filename;
        }
      }

      if (foundFile) {
        const [url] = await storage.bucket(process.env.STORAGE_BUCKET || 'ecni22026bucket')
          .file(`public/users/${foundFile}`)
          .getSignedUrl({ action: 'read', expires: Date.now() + 172800000 });
        locals.zipDownloadUrl = url;
      }
    } catch (e) {}

    try {
      locals.photos = await photoModel.getFlickrPhotos(tags, tagmode);
      locals.searchResults = true;
      res.render('index', locals);
    } catch (error) {
      res.status(500).send({ error });
    }
  });

  app.get('/historique', (req, res) => res.render('historique'));

  app.get('/historique/redis', async (req, res) => {
    try {
      const keys = await rateLimiter.client.keys('rate_limit:*');
      const data = {};
      for (const key of keys) {
        data[key] = JSON.parse(await rateLimiter.client.get(key));
      }
      res.json(data);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get('/api/users', async (req, res) => {
    try {
      const { getApp } = require('firebase-admin/app');
      const { access_token } = await getApp().options.credential.getAccessToken();
      const response = await axios.get(`https://ecni2-2026-default-rtdb.firebaseio.com/.json?shallow=true&access_token=${access_token}`);
      res.json(Object.keys(response.data || {}));
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get('/api/users/:name', async (req, res) => {
    try {
      const snapshot = await db.ref(`/${req.params.name}`).orderByKey().limitToLast(50).once('value');
      const userJobs = snapshot.val();
      const historyList = [];

      async function processJob(timestampKey, jobData) {
        if (!jobData || !jobData.filename) return;
        
        let signedUrl = null;
        try {
          const [url] = await storage.bucket(process.env.STORAGE_BUCKET || 'ecni22026bucket')
            .file(`public/users/${jobData.filename}`)
            .getSignedUrl({ action: 'read', expires: Date.now() + 172800000 });
          signedUrl = url;
        } catch(e) {}

        let num = parseInt(timestampKey);
        if (num < 10000000000) num *= 1000;
        const dateObj = jobData.createdAt ? new Date(jobData.createdAt) : new Date(num);

        historyList.push({
          dateStr: isNaN(dateObj.getTime()) ? "Date inconnue" : dateObj.toLocaleString('fr-FR'),
          dateObj: isNaN(dateObj.getTime()) ? 0 : dateObj.getTime(),
          tags: jobData.tags || 'Inconnu',
          filename: jobData.filename,
          url: signedUrl
        });
      }

      if (userJobs) {
        for (const [level1Key, level1Value] of Object.entries(userJobs)) {
          if (typeof level1Value !== 'object' || !level1Value) continue;
          if (level1Value.filename) await processJob(level1Key, level1Value);
          else {
            for (const [, level2Value] of Object.entries(level1Value)) {
              if (level2Value?.filename) await processJob(level1Key, level2Value);
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

  app.post('/zip', async (req, res) => {
    const { tags, tagmode = 'all' } = req.query;
    if (!tags) return res.status(400).send('Tags required');
    try {
      const topicName = `ecni2-${process.env.STUDENT_NUMBER || '0'}`;
      await pubsub.topic(topicName).publishMessage({ data: Buffer.from(JSON.stringify({ tags })) });
      res.redirect(`/?tags=${tags}&tagmode=${tagmode}&zipping=true`);
    } catch (error) {
      res.status(500).send('Error');
    }
  });
}

module.exports = route;
