import crypto from "node:crypto";

const HMAC_SECRET = process.env.HMAC_SECRET || "teambridge-default-secret-salt-2026";

const ENCRYPTION_KEY = crypto.scryptSync(HMAC_SECRET, "teambridge-salt-v1", 32);

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

/**
 * AES-256-GCM Credential Encryption at Rest
 */
export function encryptSecret(plaintext: string): string {
  if (!plaintext) return "";
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", ENCRYPTION_KEY, iv);
  let encrypted = cipher.update(plaintext, "utf8", "hex");
  encrypted += cipher.final("hex");
  const tag = cipher.getAuthTag().toString("hex");
  return `enc:${iv.toString("hex")}:${tag}:${encrypted}`;
}

export function decryptSecret(ciphertext: string): string {
  if (!ciphertext) return "";
  if (!ciphertext.startsWith("enc:")) return ciphertext; // Backward compatibility with unencrypted secrets
  try {
    const parts = ciphertext.split(":");
    if (parts.length !== 4) return ciphertext;
    const [, ivHex, tagHex, encryptedData] = parts;
    const iv = Buffer.from(ivHex, "hex");
    const tag = Buffer.from(tagHex, "hex");
    const decipher = crypto.createDecipheriv("aes-256-gcm", ENCRYPTION_KEY, iv);
    decipher.setAuthTag(tag);
    let decrypted = decipher.update(encryptedData, "hex", "utf8");
    decrypted += decipher.final("utf8");
    return decrypted;
  } catch {
    return ciphertext;
  }
}

/**
 * SSRF Protection Validator
 * Blocks cloud metadata (169.254.169.254, metadata.google.internal) and forbidden ports
 */
export function validateUpstreamUrl(urlStr: string): { valid: boolean; reason?: string } {
  try {
    const parsed = new URL(urlStr);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return { valid: false, reason: "Only HTTP and HTTPS protocols are permitted." };
    }
    const hostname = parsed.hostname.toLowerCase();
    
    // SSRF Blocklist: AWS, GCP, Azure, Alibaba cloud instance metadata services
    const blockedHosts = [
      "169.254.169.254",
      "metadata.google.internal",
      "100.100.100.200",
      "fd00:ec2::254",
    ];
    if (blockedHosts.includes(hostname) || hostname.startsWith("169.254.")) {
      return { valid: false, reason: "Security violation: Access to cloud instance metadata service (169.254.169.254) is blocked (SSRF defense)." };
    }

    // Block sensitive internal ports like SSH (22), Telnet (23), Docker socket, etc.
    const forbiddenPorts = ["22", "23", "25", "2375", "2376"];
    if (parsed.port && forbiddenPorts.includes(parsed.port)) {
      return { valid: false, reason: `Security violation: Port ${parsed.port} is blocked for upstream registrations.` };
    }

    return { valid: true };
  } catch (err: any) {
    return { valid: false, reason: `Malformed URL: ${err.message}` };
  }
}

