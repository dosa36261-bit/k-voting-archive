// Local operator tooling only. Reuses an existing Firebase CLI login in memory.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const auth = require(process.env.FIREBASE_CLI_AUTH_MODULE || `${process.env.APPDATA}/npm/node_modules/firebase-tools/lib/auth.js`);
const account = auth.getGlobalDefaultAccount();
if (!account) throw new Error('Run firebase login first.');
const requireFunctions = createRequire(new URL('../functions/package.json', import.meta.url));
const { Firestore } = requireFunctions('@google-cloud/firestore');
// Use the same auth-library major as Firestore's transport (header shape differs).
const requireTransport = createRequire(requireFunctions.resolve('google-gax'));
const { OAuth2Client, GoogleAuth } = requireTransport('google-auth-library');
export async function getOperatorToken() {
  const token = await auth.getAccessToken(account.tokens.refresh_token, []);
  return token.access_token;
}
const authClient = new OAuth2Client();
authClient.setCredentials({ access_token: await getOperatorToken(), expiry_date: Date.now() + 3_000_000 });
export const db = new Firestore({ projectId: 'k-voting', auth: new GoogleAuth({ authClient }) });
