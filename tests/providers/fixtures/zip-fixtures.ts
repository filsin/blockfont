import { deflateRawSync } from "node:zlib";

export type ZipFixtureCompression = "stored" | "deflate";

export interface UnihexZipFixtureOptions {
  readonly compression: ZipFixtureCompression;
  readonly dataDescriptor: boolean;
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** Builds a tiny standards-shaped Unihex archive without distributing assets. */
export function makeUnihexZipFixture(options: UnihexZipFixtureOptions): Uint8Array {
  const text = Buffer.from(
    "00E9:80000000000000000000000000000000\n",
    "utf8",
  );
  const compressed = options.compression === "stored"
    ? text
    : deflateRawSync(text);
  const method = options.compression === "stored" ? 0 : 8;
  const flags = options.dataDescriptor ? 0x08 : 0;
  const checksum = crc32(text);
  const name = Buffer.from("fixture.hex", "ascii");

  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(flags, 6);
  local.writeUInt16LE(method, 8);
  local.writeUInt32LE(options.dataDescriptor ? 0 : checksum, 14);
  local.writeUInt32LE(options.dataDescriptor ? 0 : compressed.length, 18);
  local.writeUInt32LE(options.dataDescriptor ? 0 : text.length, 22);
  local.writeUInt16LE(name.length, 26);
  local.writeUInt16LE(0, 28);

  const descriptor = options.dataDescriptor ? Buffer.alloc(16) : Buffer.alloc(0);
  if (options.dataDescriptor) {
    descriptor.writeUInt32LE(0x08074b50, 0);
    descriptor.writeUInt32LE(checksum, 4);
    descriptor.writeUInt32LE(compressed.length, 8);
    descriptor.writeUInt32LE(text.length, 12);
  }
  const localPart = Buffer.concat([local, name, compressed, descriptor]);

  const central = Buffer.alloc(46 + name.length);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(flags, 8);
  central.writeUInt16LE(method, 10);
  central.writeUInt32LE(checksum, 16);
  central.writeUInt32LE(compressed.length, 20);
  central.writeUInt32LE(text.length, 24);
  central.writeUInt16LE(name.length, 28);
  central.writeUInt16LE(0, 30);
  central.writeUInt16LE(0, 32);
  central.writeUInt16LE(0, 34);
  central.writeUInt16LE(0, 36);
  central.writeUInt32LE(0, 38);
  central.writeUInt32LE(0, 42);
  name.copy(central, 46);

  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length, 12);
  end.writeUInt32LE(localPart.length, 16);
  end.writeUInt16LE(0, 20);

  return new Uint8Array(Buffer.concat([localPart, central, end]));
}
