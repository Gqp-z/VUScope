import test from 'node:test';
import assert from 'node:assert/strict';
import {
  decryptJsonEnvelope,
  encryptJsonEnvelope,
} from './cryptoVault.ts';
import {
  checkRequestUrlAndQuery,
  inspectPayloadForThreats,
  validateExternalHttpsUrl,
} from './firewall.ts';

test('AES-256-GCM cryptoVault round-trips payloads and rejects tampered envelopes', () => {
  const secretPayload = {
    genes: ['BRCA1', 'PALB2'],
    syncedAt: '2026-04-01T10:00:00.000Z',
    count: 112,
  };
  const envelope = encryptJsonEnvelope(secretPayload);
  assert.equal(envelope.algorithm, 'aes-256-gcm');

  const decoded = decryptJsonEnvelope<typeof secretPayload>(envelope);
  assert.deepEqual(decoded, secretPayload);

  // Tampering ciphertext triggers HMAC failure
  const tampered = {
    ...envelope,
    ciphertext: envelope.ciphertext.slice(0, -4) + 'AAAA',
  };
  assert.throws(() => decryptJsonEnvelope(tampered), /HMAC/i);
});

test('WAF payload & URL inspection blocks prototype pollution, XSS, traversal, while allowing HGVS notation', () => {
  // Prototype pollution via JSON.parse preserving __proto__ property
  const protoPayload = JSON.parse('{"__proto__":{"polluted":true}}') as unknown;
  assert.ok(inspectPayloadForThreats(protoPayload)?.includes('Prototype pollution'));

  assert.ok(inspectPayloadForThreats({ $where: 'sleep(5000)' })?.includes('operator'));
  assert.ok(inspectPayloadForThreats({ q: '<script>alert(1)</script>' })?.includes('Script injection'));
  assert.ok(checkRequestUrlAndQuery('/api/lookup?q=../../etc/passwd', {})?.includes('Path traversal'));

  // Legitimate genomics payloads pass cleanly
  assert.equal(
    inspectPayloadForThreats({
      queries: ['BRCA1 c.5266dupC', 'PALB2 c.149A>C', 'rs80357433'],
      payload: 'chr17\t43091434\trs1\tG\tA\t99\tPASS\tGENE=BRCA1;HGVSC=c.123A>G',
    }),
    null,
  );
  assert.equal(checkRequestUrlAndQuery('/api/lookup?q=BRCA1%20c.5266dupC', { q: 'BRCA1 c.5266dupC' }), null);
});

test('SSRF egress firewall permits allowlisted HTTPS APIs and blocks private/HTTP targets', () => {
  const valid = validateExternalHttpsUrl('https://myvariant.info/v1/query?q=BRCA1');
  assert.equal(valid.hostname, 'myvariant.info');

  assert.throws(() => validateExternalHttpsUrl('http://myvariant.info/v1/query'), /non-HTTPS/i);
  assert.throws(() => validateExternalHttpsUrl('https://127.0.0.1:8080/secret'), /private\/loopback/i);
  assert.throws(() => validateExternalHttpsUrl('https://169.254.169.254/latest/meta-data/'), /private\/loopback/i);
  assert.throws(() => validateExternalHttpsUrl('https://evil.example.com/exfil'), /unallowlisted/i);
});
