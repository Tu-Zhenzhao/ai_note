import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "crypto";

const KEYLEN = 64;
const N = 16384;
const R = 8;
const P = 1;
type ScryptOptions = {
  N: number;
  r: number;
  p: number;
  maxmem: number;
};

function scryptWithOptions(password: string, salt: Buffer, keylen: number, options: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(password, salt, keylen, options, (error, derivedKey) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(Buffer.from(derivedKey));
    });
  });
}

function toBase64(buf: Buffer): string {
  return buf.toString("base64");
}

function fromBase64(value: string): Buffer {
  return Buffer.from(value, "base64");
}

export async function hashPassword(plainTextPassword: string): Promise<string> {
  const normalized = plainTextPassword.normalize("NFKC");
  const salt = randomBytes(16);
  const derived = await scryptWithOptions(normalized, salt, KEYLEN, {
    N,
    r: R,
    p: P,
    maxmem: 128 * 1024 * 1024,
  });
  return `scrypt$${N}$${R}$${P}$${toBase64(salt)}$${toBase64(derived)}`;
}

export async function verifyPassword(plainTextPassword: string, encodedHash: string): Promise<boolean> {
  const parts = encodedHash.split("$");
  if (parts.length !== 6) return false;
  if (parts[0] !== "scrypt") return false;

  const n = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  if (!Number.isFinite(n) || !Number.isFinite(r) || !Number.isFinite(p)) return false;

  const salt = fromBase64(parts[4]);
  const expected = fromBase64(parts[5]);
  const normalized = plainTextPassword.normalize("NFKC");
  const actual = await scryptWithOptions(normalized, salt, expected.length, {
    N: n,
    r,
    p,
    maxmem: 128 * 1024 * 1024,
  });

  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}
