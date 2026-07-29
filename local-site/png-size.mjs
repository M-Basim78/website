export function PNG_SIZE(buf) {
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}
