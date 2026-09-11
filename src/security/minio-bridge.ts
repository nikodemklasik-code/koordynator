import { isIP } from "node:net";
import { assertSecretPath } from "./vault-overlay-contract.js";

const BUCKET_RE = /^[a-z0-9](?:[a-z0-9.-]{1,61}[a-z0-9])?$/;
const DOCKER_NAMES = new Set(["minio", "power-vault-minio"]);
const SECRET_LEAK_KEYS = [
  "value", "S3_ACCESS_KEY", "S3_SECRET_KEY", "MINIO_ROOT_USER", "MINIO_ROOT_PASSWORD",
  "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "accessKey", "secretKey"
];

export type MinioConfigSnapshot = {
  endpoint: string;
  bucket: string;
  forcePathStyle: boolean;
  hasAccessKey: boolean;
  hasSecretKey: boolean;
  credentialSource: string;
};

export type MinioBridgePayload = {
  op: string;
  path?: string;
  endpoint?: string;
  bucket?: string;
};

export type MinioBridgeClient = {
  call(payload: MinioBridgePayload): Promise<Record<string, unknown>>;
};

function isPrivateHost(host: string): boolean {
  if (host === "localhost" || host === "127.0.0.1" || host === "::1") return true;
  if (DOCKER_NAMES.has(host)) return true;
  const ip = isIP(host);
  if (!ip) return false;
  if (host === "0.0.0.0") return false;
  const parts = host.split(".").map(Number);
  if (ip === 4 && parts.length === 4) {
    const [a, b] = parts as [number, number, number, number];
    if (a === 10) return true;
    if (a === 127) return true;
    if (a === 192 && b === 168) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 169 && b === 254) return true;
  }
  return false;
}

export function assertMinioEndpoint(endpoint: string): string {
  if (typeof endpoint !== "string" || !endpoint.trim()) throw new Error("MINIO_ENDPOINT_INVALID");
  let url: URL;
  try {
    url = new URL(endpoint.trim());
  } catch {
    throw new Error("MINIO_ENDPOINT_INVALID");
  }
  if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password || url.search || url.hash) {
    throw new Error("MINIO_ENDPOINT_INVALID");
  }
  if (url.pathname && url.pathname !== "/") throw new Error("MINIO_ENDPOINT_INVALID");
  if (!url.hostname || !isPrivateHost(url.hostname)) throw new Error("MINIO_ENDPOINT_PRIVATE");
  return `${url.protocol}//${url.host}`;
}

export function assertMinioBucket(bucket: string): string {
  if (typeof bucket !== "string") throw new Error("MINIO_BUCKET_REJECTED");
  const value = bucket.trim().toLowerCase();
  if (!BUCKET_RE.test(value) || value.includes("..") || value.includes(".-") || value.includes("-.")) {
    throw new Error("MINIO_BUCKET_REJECTED");
  }
  if (isIP(value)) throw new Error("MINIO_BUCKET_REJECTED");
  return value;
}

function firstValue(data: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = data[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

export function minioConfigSnapshot(data: Record<string, unknown>): MinioConfigSnapshot {
  const access = firstValue(data, ["S3_ACCESS_KEY", "MINIO_ROOT_USER", "AWS_ACCESS_KEY_ID"]);
  const secret = firstValue(data, ["S3_SECRET_KEY", "MINIO_ROOT_PASSWORD", "AWS_SECRET_ACCESS_KEY"]);
  let credentialSource = "";
  if (data.S3_ACCESS_KEY && data.S3_SECRET_KEY) credentialSource = "S3_ACCESS_KEY / S3_SECRET_KEY";
  else if (data.MINIO_ROOT_USER && data.MINIO_ROOT_PASSWORD) credentialSource = "MINIO_ROOT_USER / MINIO_ROOT_PASSWORD";
  else if (data.AWS_ACCESS_KEY_ID && data.AWS_SECRET_ACCESS_KEY) credentialSource = "AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY";
  const endpointRaw = firstValue(data, ["S3_ENDPOINT"]);
  return {
    endpoint: endpointRaw ? assertMinioEndpoint(endpointRaw) : "",
    bucket: firstValue(data, ["S3_BUCKET"]),
    forcePathStyle: firstValue(data, ["S3_FORCE_PATH_STYLE"]) !== "false",
    hasAccessKey: Boolean(access),
    hasSecretKey: Boolean(secret),
    credentialSource
  };
}

function assertNoSecretLeak(payload: Record<string, unknown>): void {
  for (const key of SECRET_LEAK_KEYS) {
    if (key in payload) throw new Error("MINIO_SECRET_LEAK");
  }
}

export class MinioWorkspace {
  constructor(private readonly client: MinioBridgeClient) {}

  async configuration(path: string): Promise<MinioConfigSnapshot> {
    assertSecretPath(path);
    const response = await this.client.call({ op: "minio_config", path });
    assertNoSecretLeak(response);
    return {
      endpoint: typeof response.endpoint === "string" ? assertMinioEndpoint(response.endpoint) : "",
      bucket: typeof response.bucket === "string" ? response.bucket : "",
      forcePathStyle: String(response.forcePathStyle ?? "true").toLowerCase() !== "false",
      hasAccessKey: response.hasAccessKey === true,
      hasSecretKey: response.hasSecretKey === true,
      credentialSource: typeof response.credentialSource === "string" ? response.credentialSource : ""
    };
  }

  async health(endpoint: string): Promise<number> {
    const safe = assertMinioEndpoint(endpoint);
    const response = await this.client.call({ op: "minio_health", endpoint: safe });
    assertNoSecretLeak(response);
    const status = Number(response.statusCode);
    if (!Number.isInteger(status) || status < 200 || status >= 400) throw new Error("MINIO_HEALTH_FAILED");
    return status;
  }

  async listBuckets(path: string): Promise<string[]> {
    assertSecretPath(path);
    const response = await this.client.call({ op: "minio_list_buckets", path });
    assertNoSecretLeak(response);
    return Array.isArray(response.buckets) ? response.buckets.map(String) : [];
  }

  async listObjects(path: string, bucket: string): Promise<string[]> {
    assertSecretPath(path);
    const safeBucket = assertMinioBucket(bucket);
    const response = await this.client.call({ op: "minio_list_objects", path, bucket: safeBucket });
    assertNoSecretLeak(response);
    return Array.isArray(response.objects) ? response.objects.map(String) : [];
  }
}
