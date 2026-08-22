import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { verifyResourceReleaseBundle } from '../src/platform/resources/resourceReleaseVerifier.ts';

const bundleArgument = process.argv[2];
if (!bundleArgument) throw new Error('用法：node scripts/verify-resource-release.mjs <resource-release.zip>');
const bundlePath = path.resolve(bundleArgument);
const bytes = new Uint8Array(fs.readFileSync(bundlePath));
const result = await verifyResourceReleaseBundle(bytes);

console.log(`RESOURCE_RELEASE_VERIFIED version=${result.manifest.releaseVersion}`);
console.log(
  `RESOURCE_RELEASE_CONTENT operators=${result.manifest.data.summary.operators} `
  + `weapons=${result.manifest.data.summary.weapons} images=${result.manifest.images.files.length} `
  + `dataBytes=${result.dataBytes.byteLength} imageArchiveBytes=${result.imageArchiveBytes.byteLength}`,
);
