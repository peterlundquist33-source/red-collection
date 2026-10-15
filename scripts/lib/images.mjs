/**
 * Local image intake.
 *
 * Images are copied, never downloaded. The pipeline will not authenticate to
 * Google Drive or fetch any remote URL: Peter exports or saves scans to a
 * local folder, and this step validates and copies them into images/cards/.
 *
 * Compression is deliberately a separate, optional step (see README) so that
 * the committed pipeline stays dependency-free.
 */

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { IMAGE_EXTENSIONS, MAX_IMAGE_BYTES } from './schema.mjs';

/** Magic-byte signatures for the formats we accept. */
const SIGNATURES = [
  { ext: '.jpg', test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { ext: '.png', test: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  {
    ext: '.webp',
    test: (b) => b.subarray(0, 4).toString('ascii') === 'RIFF' && b.subarray(8, 12).toString('ascii') === 'WEBP',
  },
  { ext: '.avif', test: (b) => b.subarray(4, 8).toString('ascii') === 'ftyp' },
];

export function sniffImageType(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return null;
  const match = SIGNATURES.find((signature) => signature.test(buffer));
  return match ? match.ext : null;
}

/**
 * Copy every acceptable image from `sourceDir` into `targetDir`.
 * Unsafe or oversized files are reported, not copied.
 */
export function copyImages(sourceDir, targetDir) {
  const copied = [];
  const skipped = [];

  if (!fs.existsSync(sourceDir)) {
    throw new Error(`image source directory not found: ${sourceDir}`);
  }

  fs.mkdirSync(targetDir, { recursive: true });

  for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
    if (!entry.isFile()) {
      skipped.push({ name: entry.name, reason: 'not a regular file' });
      continue;
    }
    const name = entry.name;
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name)) {
      skipped.push({ name, reason: 'unsafe filename (use letters, digits, dot, dash, underscore)' });
      continue;
    }
    const extension = path.extname(name).toLowerCase();
    if (!IMAGE_EXTENSIONS.includes(extension)) {
      skipped.push({ name, reason: `extension ${extension || '(none)'} not allowed` });
      continue;
    }

    const sourcePath = path.join(sourceDir, name);
    const stats = fs.statSync(sourcePath);
    if (stats.size > MAX_IMAGE_BYTES) {
      skipped.push({ name, reason: `${(stats.size / 1024 / 1024).toFixed(1)}MB exceeds the 8MB limit` });
      continue;
    }

    const buffer = fs.readFileSync(sourcePath);
    const sniffed = sniffImageType(buffer);
    if (!sniffed) {
      skipped.push({ name, reason: 'contents are not a recognised JPEG/PNG/WebP/AVIF image' });
      continue;
    }
    if (sniffed === '.jpg' ? !['.jpg', '.jpeg'].includes(extension) : sniffed !== extension) {
      skipped.push({ name, reason: `extension ${extension} does not match actual type ${sniffed}` });
      continue;
    }

    const targetPath = path.join(targetDir, name.toLowerCase());
    const digest = createHash('sha256').update(buffer).digest('hex').slice(0, 12);
    fs.writeFileSync(targetPath, buffer);
    copied.push({ name: path.basename(targetPath), bytes: stats.size, sha256: digest });
  }

  return { copied, skipped };
}
