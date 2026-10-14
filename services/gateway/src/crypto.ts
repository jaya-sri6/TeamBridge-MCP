import crypto from "node:crypto";

const HMAC_SECRET = process.env.HMAC_SECRET || "teambridge-default-secret-salt-2026";

export function generateApiKey(): { plaintext: string; prefix: string; keyHash: string } {
  const randomBytes = crypto.randomBytes(24).toString("hex");
  const plaintext = `tb_live_${randomBytes}`;
  const prefix = plaintext.substring(0, 15); // e.g. "tb_live_a1b2c3d"
  const keyHash = hashApiKey(plaintext);
  return { plaintext, prefix, keyHash };
}

export function hashApiKey(plaintext: string): string {
  return crypto.createHmac("sha256", HMAC_SECRET).update(plaintext).digest("hex");
}

export function maskSecret(secret: string): string {
  if (!secret || secret.length <= 6) return "******";
  return `${secret.slice(0, 4)}...${secret.slice(-3)}`;
}
