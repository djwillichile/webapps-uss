// Usage:
//   npm run hash-key -- <clientId>          -> generates a new random key
//   npm run hash-key -- <clientId> <key>    -> hashes an existing key
import { randomBytes } from 'node:crypto';
import { hashApiKey } from '../src/auth.js';

const [clientId, existingKey] = process.argv.slice(2);
if (!clientId || !/^[a-zA-Z0-9_-]{1,64}$/.test(clientId)) {
  console.error('Usage: npm run hash-key -- <clientId> [key]');
  process.exit(1);
}
const key = existingKey ?? randomBytes(32).toString('base64url');
const hash = hashApiKey(key).toString('hex');

console.log(`API key for "${clientId}" (give it to the client, do NOT store it on the server):\n  ${key}\n`);
console.log(`Entry for API_KEYS in .env (only the hash is stored):\n  ${clientId}:${hash}`);
