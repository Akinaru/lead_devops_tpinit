const rateLimitMap = new Map();

function tokenBucketMiddleware(req, res, next) {
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';

  const REFILL_RATE = 1;
  const MAX_TOKENS = 15;
  const COST = 3;

  const now = Date.now();

  if (!rateLimitMap.has(ip)) {
    rateLimitMap.set(ip, { tokens: MAX_TOKENS, lastRefill: now });
  }

  const state = rateLimitMap.get(ip);
  const secondsElapsed = (now - state.lastRefill) / 1000;

  let currentTokens = state.tokens + (secondsElapsed * REFILL_RATE);
  if (currentTokens > MAX_TOKENS) {
    currentTokens = MAX_TOKENS;
  }

  if (currentTokens >= COST) {
    rateLimitMap.set(ip, {
      tokens: currentTokens - COST,
      lastRefill: now
    });
    next();
  } else {
    rateLimitMap.set(ip, {
      tokens: currentTokens,
      lastRefill: now
    });
    res.status(429).send("Too Many Requests: Vous avez dépassé votre quota de requêtes. Veuillez patienter.");
  }
}

module.exports = tokenBucketMiddleware;
