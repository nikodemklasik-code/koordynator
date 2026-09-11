import { generateKeyPairSync } from "node:crypto";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

/**
 * Control-plane signing identity used to materialise chat-agreed plans into Tasks.
 *
 * The key is generated once and kept private to the state directory (0600). It is a
 * SEPARATE identity from any operator key: tasks it signs are attributable to the
 * control plane, so `initiatedBy` never impersonates a human signer.
 */
export type ControlSigningIdentity = {
  privateKeyPem: string;
  publicKeyPem: string;
  keyId: string;
};

export async function loadOrCreateControlSigningKey(stateDir: string): Promise<ControlSigningIdentity> {
  const directory = resolve(stateDir, "keys");
  const privatePath = join(directory, "control-plane.key.pem");
  const publicPath = join(directory, "control-plane.pub.pem");
  const keyId = "control-plane";

  try {
    const [privateKeyPem, publicKeyPem] = await Promise.all([
      readFile(privatePath, "utf8"),
      readFile(publicPath, "utf8")
    ]);
    if (privateKeyPem.includes("PRIVATE KEY")) return { privateKeyPem, publicKeyPem, keyId };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const publicKeyPem = publicKey.export({ type: "spki", format: "pem" }).toString();

  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700);
  await writeFile(privatePath, privateKeyPem, { encoding: "utf8", mode: 0o600 });
  await writeFile(publicPath, publicKeyPem, { encoding: "utf8", mode: 0o644 });
  return { privateKeyPem, publicKeyPem, keyId };
}
