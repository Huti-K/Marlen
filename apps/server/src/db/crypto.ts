import crypto from "node:crypto";
import { env } from "../env.js";

const ALGORITHM = "aes-256-gcm";
const PREFIX = "enc:v1:";

function getKey(): Buffer | null {
  if (!env.encryptionKey) return null;
  const key = Buffer.from(env.encryptionKey, "utf-8");
  if (key.length !== 32) {
    console.warn("ENCRYPTION_KEY must be exactly 32 bytes. Encryption is disabled.");
    return null;
  }
  return key;
}

export function encrypt(text: string): string {
  const key = getKey();
  if (!key) return text;

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  
  let encrypted = cipher.update(text, "utf8", "base64");
  encrypted += cipher.final("base64");
  const authTag = cipher.getAuthTag().toString("base64");

  return `${PREFIX}${iv.toString("base64")}:${authTag}:${encrypted}`;
}

export function decrypt(text: string): string {
  if (!text.startsWith(PREFIX)) return text;

  const key = getKey();
  if (!key) {
    console.error("Cannot decrypt value: ENCRYPTION_KEY is missing or invalid.");
    return text;
  }

  try {
    const parts = text.slice(PREFIX.length).split(":");
    if (parts.length !== 3) return text;
    
    const [ivBase64, authTagBase64, encrypted] = parts;
    if (!ivBase64 || !authTagBase64 || !encrypted) return text;

    const iv = Buffer.from(ivBase64, "base64");
    const authTag = Buffer.from(authTagBase64, "base64");
    
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);
    
    let decrypted = decipher.update(encrypted, "base64", "utf8");
    decrypted += decipher.final("utf8");
    return decrypted;
  } catch (error) {
    console.error("Failed to decrypt data", error);
    return text;
  }
}
