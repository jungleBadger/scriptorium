// server/services/r2.js
// Cloudflare R2 client via S3-compatible API.
// Env vars: R2_URL, R2_BUCKET_NAME, R2_ACCESS_KEY, R2_SECRET_ACCESS_KEY

import {
  S3Client,
  HeadObjectCommand,
  PutObjectCommand,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

let _client = null;

function getClient() {
  if (!_client) {
    _client = new S3Client({
      region: "auto",
      endpoint: process.env.R2_URL,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
      },
    });
  }
  return _client;
}

function bucket() {
  return process.env.R2_BUCKET_NAME;
}

export async function r2Exists(key) {
  try {
    await getClient().send(new HeadObjectCommand({ Bucket: bucket(), Key: key }));
    return true;
  } catch (err) {
    if (err.name === "NotFound" || err.$metadata?.httpStatusCode === 404) return false;
    throw err;
  }
}

export async function r2Upload(key, buffer, contentType = "audio/mpeg") {
  await getClient().send(
    new PutObjectCommand({
      Bucket: bucket(),
      Key: key,
      Body: buffer,
      ContentType: contentType,
      ContentLength: buffer.length,
    })
  );
}

// Returns a pre-signed URL valid for `expiresIn` seconds (default 24h).
// The browser uses this URL directly to stream audio with full Range support.
export async function r2GetSignedUrl(key, expiresIn = 86400) {
  return getSignedUrl(
    getClient(),
    new GetObjectCommand({ Bucket: bucket(), Key: key }),
    { expiresIn }
  );
}
