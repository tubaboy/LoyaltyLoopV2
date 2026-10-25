import { createReadStream } from "node:fs";
import { mkdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const localStorageRoot = path.resolve(process.env.LOCAL_STORAGE_PATH ?? "./uploads");

function localObjectPath(objectKey: string): string {
  const resolvedPath = path.resolve(localStorageRoot, objectKey);
  if (!resolvedPath.startsWith(`${localStorageRoot}${path.sep}`)) {
    throw new Error("INVALID_STORAGE_OBJECT_KEY");
  }
  return resolvedPath;
}

export type StoredObject = {
  body: NodeJS.ReadableStream;
  contentType: string | undefined;
  contentLength: number | undefined;
};

export async function putObject(
  objectKey: string,
  body: Buffer,
): Promise<void> {
  const destination = localObjectPath(objectKey);
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, body, { flag: "wx" });
}

export async function getObject(objectKey: string): Promise<StoredObject> {
  const destination = localObjectPath(objectKey);
  const details = await stat(destination);
  return {
    body: createReadStream(destination),
    contentType: undefined,
    contentLength: details.size,
  };
}

export async function deleteObject(objectKey: string): Promise<void> {
  await rm(localObjectPath(objectKey), { force: true });
}
