import { initializeApp } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { createArchiveService } from './service.js';
initializeApp();
const service = createArchiveService(getFirestore(), { fail: (code, message) => { throw new HttpsError(code, message); }, timestamp: value => Timestamp.fromMillis(value) });
export const archiveApi = onCall({ region: 'asia-northeast3', memory: '256MiB', maxInstances: 3, concurrency: 10, timeoutSeconds: 60 }, async request => {
  if (!request.auth) throw new HttpsError('unauthenticated', '인증 연결을 확인한 뒤 다시 시도해주세요.');
  return service(request.data, { uid: request.auth.uid, ip: request.rawRequest.ip || 'unknown' });
});
