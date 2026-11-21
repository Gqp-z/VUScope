import crypto from 'node:crypto';

export interface EncryptedEnvelope {
  version: 1;
  algorithm: 'aes-256-gcm';
  iv: string;
  authTag: string;
  ciphertext: string;
  sha256: string;
  hmac: string;
  sealedAt: string;
}

const EPHEMERAL_ENCRYPTION_SEED = crypto.randomBytes(32);
const EPHEMERAL_HMAC_SEED = crypto.randomBytes(32);

function resolveEncryptionKey(): Buffer {
  const configured = process.env.VUSCOPE_DB_ENCRYPTION_KEY?.trim();
  if (configured && configured.length >= 16) {
    return crypto.scryptSync(configured, 'vuscope-local-db-salt-v1', 32);
  }
  return crypto
    .createHash('sha256')
    .update(EPHEMERAL_ENCRYPTION_SEED)
    .update('vuscope-aes-gcm-v1')
    .digest();
}

function resolveHmacKey(): Buffer {
  const configured = process.env.VUSCOPE_HMAC_SECRET?.trim();
  if (configured && configured.length >= 16) {
    return crypto.scryptSync(configured, 'vuscope-hmac-salt-v1', 32);
  }
  return crypto
    .createHash('sha256')
    .update(EPHEMERAL_HMAC_SEED)
    .update('vuscope-hmac-sha256-v1')
    .digest();
}

export function isPersistentKeyConfigured(): boolean {
  return Boolean(
    process.env.VUSCOPE_DB_ENCRYPTION_KEY?.trim() &&
      process.env.VUSCOPE_DB_ENCRYPTION_KEY.trim().length >= 16,
  );
}

export function computeSha256(data: string | Buffer): string {
  return crypto.createHash('sha256').update(data).digest('hex');
}

export function signDataRecord(payload: string): string {
  return crypto.createHmac('sha256', resolveHmacKey()).update(payload).digest('hex');
}

export function verifyDataRecord(payload: string, expectedHmacHex: string): boolean {
  if (!expectedHmacHex || !/^[0-9a-f]{64}$/i.test(expectedHmacHex)) {
    return false;
  }
  const actual = Buffer.from(signDataRecord(payload), 'hex');
  const expected = Buffer.from(expectedHmacHex, 'hex');
  if (actual.length !== expected.length) {
    return false;
  }
  return crypto.timingSafeEqual(actual, expected);
}

export function encryptJsonEnvelope<T>(value: T): EncryptedEnvelope {
  const plaintext = JSON.stringify(value);
  const sha256 = computeSha256(plaintext);
  const iv = crypto.randomBytes(12);
  const key = resolveEncryptionKey();

  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  const ciphertextB64 = encrypted.toString('base64');
  const ivB64 = iv.toString('base64');
  const tagB64 = authTag.toString('base64');
  const sealedAt = new Date().toISOString();

  const canonicalToSign = `${ivB64}.${tagB64}.${ciphertextB64}.${sha256}.${sealedAt}`;
  const hmac = signDataRecord(canonicalToSign);

  return {
    version: 1,
    algorithm: 'aes-256-gcm',
    iv: ivB64,
    authTag: tagB64,
    ciphertext: ciphertextB64,
    sha256,
    hmac,
    sealedAt,
  };
}

export function decryptJsonEnvelope<T>(envelope: EncryptedEnvelope): T {
  if (
    !envelope ||
    envelope.version !== 1 ||
    envelope.algorithm !== 'aes-256-gcm'
  ) {
    throw new Error('Unsupported or malformed encrypted envelope.');
  }

  const canonicalToVerify = `${envelope.iv}.${envelope.authTag}.${envelope.ciphertext}.${envelope.sha256}.${envelope.sealedAt}`;
  if (!verifyDataRecord(canonicalToVerify, envelope.hmac)) {
    throw new Error('Encrypted envelope HMAC signature verification failed.');
  }

  const key = resolveEncryptionKey();
  const iv = Buffer.from(envelope.iv, 'base64');
  const authTag = Buffer.from(envelope.authTag, 'base64');
  const ciphertext = Buffer.from(envelope.ciphertext, 'base64');

  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]).toString('utf8');

  if (computeSha256(decrypted) !== envelope.sha256) {
    throw new Error('Decrypted payload SHA-256 checksum mismatch.');
  }

  return JSON.parse(decrypted) as T;
}
