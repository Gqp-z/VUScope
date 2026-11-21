export interface ClientEncryptedEnvelope {
  version: 1;
  cipher: 'AES-GCM-256';
  kdf: 'PBKDF2-SHA256';
  saltB64: string;
  ivB64: string;
  ciphertextB64: string;
  sha256: string;
  exportedAt: string;
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function fromBase64(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

export async function sha256Hex(text: string): Promise<string> {
  const encoded = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', toArrayBuffer(encoded));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function deriveAesKey(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    toArrayBuffer(new TextEncoder().encode(passphrase)),
    { name: 'PBKDF2' },
    false,
    ['deriveKey'],
  );

  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: toArrayBuffer(salt),
      iterations: 100_000,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export async function encryptLocalSnapshot<T>(
  data: T,
  passphrase: string,
): Promise<ClientEncryptedEnvelope> {
  if (!passphrase || passphrase.trim().length < 8) {
    throw new Error('Provide a passphrase of at least 8 characters to encrypt the snapshot.');
  }
  const plaintext = JSON.stringify(data);
  const sha256 = await sha256Hex(plaintext);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const aesKey = await deriveAesKey(passphrase, salt);

  const encryptedBuf = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: toArrayBuffer(iv) },
    aesKey,
    toArrayBuffer(new TextEncoder().encode(plaintext)),
  );

  return {
    version: 1,
    cipher: 'AES-GCM-256',
    kdf: 'PBKDF2-SHA256',
    saltB64: toBase64(salt),
    ivB64: toBase64(iv),
    ciphertextB64: toBase64(new Uint8Array(encryptedBuf)),
    sha256,
    exportedAt: new Date().toISOString(),
  };
}

export async function decryptLocalSnapshot<T>(
  envelope: ClientEncryptedEnvelope,
  passphrase: string,
): Promise<T> {
  const salt = fromBase64(envelope.saltB64);
  const iv = fromBase64(envelope.ivB64);
  const ciphertext = fromBase64(envelope.ciphertextB64);
  const aesKey = await deriveAesKey(passphrase, salt);

  const decryptedBuf = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: toArrayBuffer(iv) },
    aesKey,
    toArrayBuffer(ciphertext),
  );
  const plaintext = new TextDecoder().decode(decryptedBuf);
  const digest = await sha256Hex(plaintext);
  if (digest !== envelope.sha256) {
    throw new Error('Snapshot SHA-256 integrity check failed.');
  }
  return JSON.parse(plaintext) as T;
}
