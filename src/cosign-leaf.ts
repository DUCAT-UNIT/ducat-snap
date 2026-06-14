const COSIGN_LEAF_PATTERN = /^20(?<client>[0-9a-f]{64})ad20(?<guard>[0-9a-f]{64})ac(?<envelope>[0-9a-f]*)$/u;

const OP_0 = 0x00;
const OP_IF = 0x63;
const OP_ENDIF = 0x68;
const OP_PUSHDATA1 = 0x4c;
const OP_PUSHDATA2 = 0x4d;
const OP_PUSHDATA4 = 0x4e;
const ORD_TAG_HEX = '036f7264';

export type CosignLeafMatch = {
  client: string;
  guard: string;
};

function hexToBytes(value: string): Uint8Array | null {
  if (value.length % 2 !== 0 || !/^[0-9a-f]*$/u.test(value)) {
    return null;
  }

  const output = new Uint8Array(value.length / 2);

  for (let index = 0; index < output.length; index += 1) {
    output[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
  }

  return output;
}

export function isOrdEnvelope(envelopeHex: string): boolean {
  if (!envelopeHex.startsWith(`0063${ORD_TAG_HEX}`) || !envelopeHex.endsWith('68')) {
    return false;
  }

  const bytes = hexToBytes(envelopeHex);

  if (!bytes || bytes[0] !== OP_0 || bytes[1] !== OP_IF) {
    return false;
  }

  let offset = 2;

  while (offset < bytes.length) {
    const opcode = bytes[offset];
    offset += 1;

    if (opcode === OP_ENDIF) {
      return offset === bytes.length;
    }

    let pushLength: number;

    if (opcode < OP_PUSHDATA1) {
      pushLength = opcode;
    } else if (opcode === OP_PUSHDATA1) {
      if (offset + 1 > bytes.length) {
        return false;
      }

      pushLength = bytes[offset];
      offset += 1;
    } else if (opcode === OP_PUSHDATA2) {
      if (offset + 2 > bytes.length) {
        return false;
      }

      pushLength = bytes[offset] | (bytes[offset + 1] << 8);
      offset += 2;
    } else if (opcode === OP_PUSHDATA4) {
      if (offset + 4 > bytes.length) {
        return false;
      }

      pushLength = (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0;
      offset += 4;
    } else {
      return false;
    }

    offset += pushLength;

    if (offset > bytes.length) {
      return false;
    }
  }

  return false;
}

export function matchCosignLeafHex(leafHex: string): CosignLeafMatch | null {
  const match = COSIGN_LEAF_PATTERN.exec(leafHex.toLowerCase());

  if (!match?.groups) {
    return null;
  }

  const { client, guard, envelope } = match.groups;

  if (!client || !guard) {
    return null;
  }

  if (envelope && !isOrdEnvelope(envelope)) {
    return null;
  }

  return { client, guard };
}
