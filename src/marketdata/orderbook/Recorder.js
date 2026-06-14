import fs from 'node:fs';
import path from 'node:path';

/** Pure: stamp + serialize one raw frame to a JSONL line. */
export function frameLine(t, sym, venue, frame) {
  return JSON.stringify({ t, sym, v: venue, ...frame });
}

function dayUTC(ms) {
  return new Date(ms).toISOString().slice(0, 10); // YYYY-MM-DD
}

/**
 * Appends raw order-book frames to JSONL, one file per symbol/venue/UTC-day.
 * Uses synchronous file descriptors so writes are durable before write() returns.
 * One open fd per symbol/venue/day key, reused across writes.
 */
export class Recorder {
  constructor({ root = 'data/orderbook' } = {}) {
    this.root = root;
    this.fds = new Map(); // fileKey -> fd (open for append)
  }

  write(sym, venue, t, frame) {
    const day = dayUTC(t);
    const key = `${sym}/${venue}/${day}`;
    let fd = this.fds.get(key);
    if (fd === undefined) {
      const dir = path.join(this.root, sym, venue);
      fs.mkdirSync(dir, { recursive: true });
      fd = fs.openSync(path.join(dir, `${day}.jsonl`), 'a');
      this.fds.set(key, fd);
    }
    fs.writeSync(fd, frameLine(t, sym, venue, frame) + '\n');
  }

  close() {
    for (const fd of this.fds.values()) fs.closeSync(fd);
    this.fds.clear();
  }
}
