import { describe, it, expect } from 'vitest';
import { encryptSecret, decryptSecret } from '../../src/main/security/credentialVault';

/** tests/unit/mocks/electron.ts's safeStorage always reports encryption
 * unavailable, so every encryptSecret() call here exercises the AES-GCM
 * fallback path, not the (untestable-under-plain-Node) real safeStorage
 * path — see that mock's own doc comment. */
describe('credentialVault', () => {
  it('round-trips a secret through the fallback path', () => {
    const encrypted = encryptSecret('super-secret-proxy-password');
    expect(decryptSecret(encrypted)).toBe('super-secret-proxy-password');
  });

  it('the fallback output is not plaintext — the original value never appears in the stored bytes', () => {
    const secret = 'hunter2-but-longer-so-it-would-be-obvious-if-leaked';
    const encrypted = encryptSecret(secret);
    expect(encrypted.toString('utf-8')).not.toContain(secret);
    expect(encrypted.toString('latin1')).not.toContain(secret);
  });

  it('is tagged with the AES-GCM fallback marker, not the legacy plaintext marker', () => {
    const encrypted = encryptSecret('anything');
    expect(encrypted.subarray(0, 8).toString('utf-8')).toBe('AESGCM1:');
  });

  it('two encryptions of the same plaintext produce different ciphertext (random IV per call)', () => {
    const a = encryptSecret('same-value');
    const b = encryptSecret('same-value');
    expect(a.equals(b)).toBe(false);
    expect(decryptSecret(a)).toBe('same-value');
    expect(decryptSecret(b)).toBe('same-value');
  });

  it('tampering with the ciphertext is detected (GCM auth tag) rather than silently returning garbage', () => {
    const encrypted = encryptSecret('do-not-tamper');
    const tampered = Buffer.from(encrypted);
    tampered[tampered.length - 1] = tampered[tampered.length - 1]! ^ 0xff;
    expect(() => decryptSecret(tampered)).toThrow();
  });

  it('still decrypts a legacy plaintext-marked row written before this fallback existed', () => {
    const legacy = Buffer.from('PLAINTEXT:an-old-unencrypted-password', 'utf-8');
    expect(decryptSecret(legacy)).toBe('an-old-unencrypted-password');
  });

  it('handles an empty-string secret', () => {
    const encrypted = encryptSecret('');
    expect(decryptSecret(encrypted)).toBe('');
  });

  it('handles a secret containing unicode', () => {
    const secret = 'пароль-🔒-mit-Ümlaut';
    expect(decryptSecret(encryptSecret(secret))).toBe(secret);
  });
});
