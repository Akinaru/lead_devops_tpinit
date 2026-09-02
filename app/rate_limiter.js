const { createClient } = require('redis');

const client = createClient({
  username: process.env.REDIS_USER,
  password: process.env.REDIS_PASSWORD,
  socket: {
    host: process.env.REDIS_HOST,
    port: parseInt(process.env.REDIS_PORT)
  }
});

client.on('error', () => {});
client.connect().catch(() => {});

async function middleware(req, res, next) {
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
  const now = Date.now();

  try {
    const rawState = await client.get(`rate_limit:${ip}`);
    const state = rawState ? JSON.parse(rawState) : { tokens: 15, lastRefill: now };
    
    let currentTokens = Math.min(15, state.tokens + ((now - state.lastRefill) / 1000));

    if (currentTokens >= 3) {
      await client.set(`rate_limit:${ip}`, JSON.stringify({ tokens: currentTokens - 3, lastRefill: now }));
      next();
    } else {
      await client.set(`rate_limit:${ip}`, JSON.stringify({ tokens: currentTokens, lastRefill: now }));
      res.status(429).send("Too Many Requests");
    }
  } catch (error) {
    next();
  }
}

module.exports = { middleware, client };
