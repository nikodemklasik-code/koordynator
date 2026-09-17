import { describe, expect, it } from "vitest";
import {
  assertMinioBucket,
  assertMinioEndpoint,
  minioConfigSnapshot,
  MinioWorkspace
} from "../src/security/minio-bridge.js";

const SECRET = "SECRET_TEST_ONLY";
const ACCESS = "ACCESS_TEST_ONLY";

describe("MinIO overlay bridge", () => {
  it("accepts loopback, private and overlay docker names, and rejects public SSRF endpoints", () => {
    expect(() => assertMinioEndpoint("http://127.0.0.1:9000")).not.toThrow();
    expect(() => assertMinioEndpoint("http://localhost:9001")).not.toThrow();
    expect(() => assertMinioEndpoint("http://10.8.0.4:9000")).not.toThrow();
    expect(() => assertMinioEndpoint("http://minio")).not.toThrow();
    expect(() => assertMinioEndpoint("http://power-vault-minio")).not.toThrow();
    expect(() => assertMinioEndpoint("https://8.8.8.8:9000")).toThrow(/MINIO_ENDPOINT_PRIVATE/);
    expect(() => assertMinioEndpoint("http://user:pass@127.0.0.1:9000")).toThrow(/MINIO_ENDPOINT_INVALID/);
    expect(() => assertMinioEndpoint("http://127.0.0.1:9000/admin")).toThrow(/MINIO_ENDPOINT_INVALID/);
  });

  it("rejects IP-shaped and traversal bucket names", () => {
    expect(assertMinioBucket("multivohub")).toBe("multivohub");
    expect(() => assertMinioBucket("1.2.3.4")).toThrow(/MINIO_BUCKET_REJECTED/);
    expect(() => assertMinioBucket("..")).toThrow(/MINIO_BUCKET_REJECTED/);
    expect(() => assertMinioBucket("AB")).toThrow(/MINIO_BUCKET_REJECTED/);
  });

  it("returns MinIO config metadata without copying access or secret keys to the Mac", () => {
    const snapshot = minioConfigSnapshot({
      S3_ENDPOINT: "http://127.0.0.1:9000",
      S3_BUCKET: "multivohub",
      S3_ACCESS_KEY: ACCESS,
      S3_SECRET_KEY: SECRET,
      S3_FORCE_PATH_STYLE: "true"
    });
    expect(snapshot).toEqual({
      endpoint: "http://127.0.0.1:9000",
      bucket: "multivohub",
      forcePathStyle: true,
      hasAccessKey: true,
      hasSecretKey: true,
      credentialSource: "S3_ACCESS_KEY / S3_SECRET_KEY"
    });
    expect(JSON.stringify(snapshot)).not.toContain(ACCESS);
    expect(JSON.stringify(snapshot)).not.toContain(SECRET);
    expect("value" in snapshot).toBe(false);
  });

  it("refuses to surface credential fields from a bridge response", async () => {
    const workspace = new MinioWorkspace({
      async call() {
        return { ok: true, endpoint: "http://127.0.0.1:9000", S3_SECRET_KEY: SECRET, value: SECRET };
      }
    });
    await expect(workspace.configuration("secret/apps/project")).rejects.toThrow(/MINIO_SECRET_LEAK/);
  });

  it("lists buckets and object names through the bridge without returning secrets", async () => {
    const workspace = new MinioWorkspace({
      async call(payload) {
        if (payload.op === "minio_config") {
          return {
            ok: true,
            endpoint: "http://127.0.0.1:9000",
            bucket: "multivohub",
            forcePathStyle: "true",
            hasAccessKey: true,
            hasSecretKey: true,
            credentialSource: "S3_ACCESS_KEY / S3_SECRET_KEY"
          };
        }
        if (payload.op === "minio_list_buckets") return { ok: true, buckets: ["multivohub", "power-vault"] };
        if (payload.op === "minio_list_objects") return { ok: true, objects: ["a.pdf", "b.json"] };
        if (payload.op === "minio_health") return { ok: true, statusCode: 200, endpoint: "http://127.0.0.1:9000" };
        throw new Error(`unexpected op ${String(payload.op)}`);
      }
    });
    expect(await workspace.configuration("secret/apps/project")).toMatchObject({
      hasAccessKey: true,
      hasSecretKey: true,
      bucket: "multivohub"
    });
    expect(await workspace.listBuckets("secret/apps/project")).toEqual(["multivohub", "power-vault"]);
    expect(await workspace.listObjects("secret/apps/project", "multivohub")).toEqual(["a.pdf", "b.json"]);
    expect(await workspace.health("http://127.0.0.1:9000")).toBe(200);
  });
});
