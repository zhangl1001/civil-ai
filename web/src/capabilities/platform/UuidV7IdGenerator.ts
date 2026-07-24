import type { Brand, Clock, IdGenerator } from '@/kernel/public';

function formatUuid(bytes: Uint8Array): string {
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export class UuidV7IdGenerator implements IdGenerator {
  private lastTimestampMs = -1;
  private sequence = 0;

  constructor(private readonly clock: Clock) {}

  next<Name extends string>(namespace: Name): Brand<string, Name> {
    const physicalTimestampMs = Number(this.clock.now());
    if (!Number.isSafeInteger(physicalTimestampMs) || physicalTimestampMs < 0 || physicalTimestampMs > 0xffffffffffff) {
      throw new RangeError('UUIDv7 timestamp is outside the 48-bit range');
    }

    let timestampMs = Math.max(physicalTimestampMs, this.lastTimestampMs);
    if (timestampMs === this.lastTimestampMs) {
      this.sequence += 1;
      if (this.sequence > 0x0fff) {
        timestampMs += 1;
        this.sequence = 0;
      }
    } else {
      const seed = new Uint16Array(1);
      crypto.getRandomValues(seed);
      this.sequence = seed[0] & 0x0fff;
    }
    this.lastTimestampMs = timestampMs;

    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    let timestamp = timestampMs;
    for (let index = 5; index >= 0; index -= 1) {
      bytes[index] = timestamp & 0xff;
      timestamp = Math.floor(timestamp / 256);
    }
    bytes[6] = 0x70 | ((this.sequence >> 8) & 0x0f);
    bytes[7] = this.sequence & 0xff;
    bytes[8] = 0x80 | (bytes[8] & 0x3f);

    return `${namespace}:${formatUuid(bytes)}` as Brand<string, Name>;
  }
}
