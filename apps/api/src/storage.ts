import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

const bucket = process.env.S3_BUCKET ?? "loyaltyloop-v2";
const client = new S3Client({
  endpoint: process.env.S3_ENDPOINT ?? "http://localhost:19000",
  region: process.env.S3_REGION ?? "us-east-1",
  forcePathStyle: process.env.S3_FORCE_PATH_STYLE !== "false",
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY_ID ?? "loyaltyloop_local",
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? "loyaltyloop_local_only",
  },
});

let bucketReady: Promise<void> | null = null;

export type StoredObject = {
  body: NodeJS.ReadableStream;
  contentType: string | undefined;
  contentLength: number | undefined;
};

async function ensureBucket(): Promise<void> {
  if (!bucketReady) {
    bucketReady = (async () => {
      try {
        await client.send(new HeadBucketCommand({ Bucket: bucket }));
      } catch (error) {
        const code = (error as { name?: string; Code?: string }).name ?? (error as { Code?: string }).Code;
        if (code !== "NotFound" && code !== "NoSuchBucket") throw error;
        await client.send(new CreateBucketCommand({ Bucket: bucket }));
      }
    })().catch((error) => {
      bucketReady = null;
      throw error;
    });
  }

  await bucketReady;
}

export async function putObject(
  objectKey: string,
  body: Buffer,
  contentType: string,
): Promise<void> {
  await ensureBucket();
  await client.send(new PutObjectCommand({
    Bucket: bucket,
    Key: objectKey,
    Body: body,
    ContentType: contentType,
  }));
}

export async function getObject(objectKey: string): Promise<StoredObject> {
  await ensureBucket();
  const result = await client.send(new GetObjectCommand({ Bucket: bucket, Key: objectKey }));
  const body = result.Body as NodeJS.ReadableStream | undefined;
  if (!body || typeof (body as NodeJS.ReadableStream & { pipe?: unknown }).pipe !== "function") {
    throw new Error("STORAGE_OBJECT_STREAM_UNAVAILABLE");
  }

  return {
    body,
    contentType: result.ContentType,
    contentLength: result.ContentLength,
  };
}

export async function deleteObject(objectKey: string): Promise<void> {
  await ensureBucket();
  await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: objectKey }));
}
