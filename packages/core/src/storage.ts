import { createHash, randomUUID } from "node:crypto";
import {
  closeSync,
  constants,
  existsSync,
  fsyncSync,
  fstatSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";

export const sha256 = (bytes: string | Buffer): string =>
  createHash("sha256").update(bytes).digest("hex");

export function directory(path: string): void {
  if (!existsSync(path)) mkdirSync(path, { mode: 0o700 });
  if (!lstatSync(path).isDirectory() || lstatSync(path).isSymbolicLink())
    throw new Error(`Expected a real directory: ${path}`);
}

export function readRegular(path: string, limit = 100 * 1024 * 1024): Buffer {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = fstatSync(fd);
    if (!before.isFile() || before.size > limit)
      throw new Error("Expected a regular file no larger than 100 MiB");
    const bytes = readFileSync(fd);
    const after = fstatSync(fd);
    if (
      bytes.length > limit ||
      before.size !== after.size ||
      before.mtimeMs !== after.mtimeMs
    )
      throw new Error("File changed while reading; retry import");
    return bytes;
  } finally {
    closeSync(fd);
  }
}

export function syncDirectory(path: string): void {
  const fd = openSync(path, constants.O_RDONLY);
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

/** Publish immutable bytes without ever replacing an existing file. */
export function writeImmutable(path: string, bytes: Buffer): void {
  if (existsSync(path)) {
    if (!readRegular(path).equals(bytes))
      throw new Error(`Existing file differs; refusing overwrite: ${path}`);
    return;
  }
  const temp = join(dirname(path), `.pending-${randomUUID()}`);
  const fd = openSync(temp, "wx", 0o600);
  try {
    writeFileSync(fd, bytes);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  try {
    try {
      linkSync(temp, path);
    } catch (error) {
      if (
        (error as NodeJS.ErrnoException).code !== "EEXIST" ||
        !readRegular(path).equals(bytes)
      )
        throw error;
    }
    syncDirectory(dirname(path));
  } finally {
    unlinkSync(temp);
  }
}
