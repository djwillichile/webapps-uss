import { createHash, timingSafeEqual } from 'node:crypto';

export function hashApiKey(key) {
  return createHash('sha256').update(key, 'utf8').digest();
}

// Returns the clientId owning the key, or null. Every stored hash is compared with
// timingSafeEqual so response time does not reveal how close a guess was.
export function findClient(clients, presentedKey) {
  if (typeof presentedKey !== 'string' || presentedKey.length < 16 || presentedKey.length > 256) {
    return null;
  }
  const presented = hashApiKey(presentedKey);
  let match = null;
  for (const client of clients) {
    if (timingSafeEqual(presented, client.hash)) match = client.clientId;
  }
  return match;
}

export function apiKeyAuth(clients) {
  return (req, res, next) => {
    const clientId = findClient(clients, req.get('x-api-key'));
    if (!clientId) {
      return res.status(401).json({ error: 'unauthorized' });
    }
    req.clientId = clientId;
    next();
  };
}
