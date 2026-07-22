import fs from 'node:fs/promises';

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const CRC_TABLE = new Uint32Array(256).map((_, index) => {
  let crc = index;
  for (let bit = 0; bit < 8; bit += 1) {
    crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  }
  return crc >>> 0;
});

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function makeChunk(type, data) {
  const typeBuffer = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crcBuffer = Buffer.alloc(4);
  crcBuffer.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crcBuffer]);
}

function textChunk(keyword, text) {
  return makeChunk('tEXt', Buffer.concat([
    Buffer.from(keyword, 'latin1'),
    Buffer.from([0]),
    Buffer.from(text, 'utf8')
  ]));
}

export function dataUrlToBuffer(dataUrl) {
  const match = String(dataUrl || '').match(/^data:image\/png;base64,(.+)$/);
  if (!match) throw new Error('请上传 PNG 图片作为角色卡头像底图');
  return Buffer.from(match[1], 'base64');
}

export function embedCardInPng(pngBuffer, cardJson) {
  if (!pngBuffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error('头像文件不是有效 PNG');
  }
  const chunks = [];
  let offset = 8;
  let inserted = false;
  chunks.push(PNG_SIGNATURE);
  const cardText = JSON.stringify(cardJson);
  const charaChunk = textChunk('chara', Buffer.from(cardText, 'utf8').toString('base64'));

  while (offset < pngBuffer.length) {
    const length = pngBuffer.readUInt32BE(offset);
    const type = pngBuffer.subarray(offset + 4, offset + 8).toString('ascii');
    const chunkEnd = offset + 12 + length;
    if (type === 'IEND' && !inserted) {
      chunks.push(charaChunk);
      inserted = true;
    }
    if (type !== 'tEXt') {
      chunks.push(pngBuffer.subarray(offset, chunkEnd));
    } else {
      const dataStart = offset + 8;
      const textData = pngBuffer.subarray(dataStart, dataStart + length);
      const keyword = textData.subarray(0, textData.indexOf(0)).toString('latin1');
      if (keyword !== 'chara') chunks.push(pngBuffer.subarray(offset, chunkEnd));
    }
    offset = chunkEnd;
  }

  return Buffer.concat(chunks);
}

export function readCardJsonFromPng(pngBuffer) {
  if (!Buffer.isBuffer(pngBuffer) || !pngBuffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error('文件不是有效 PNG');
  }

  let offset = 8;
  while (offset + 12 <= pngBuffer.length) {
    const length = pngBuffer.readUInt32BE(offset);
    const type = pngBuffer.subarray(offset + 4, offset + 8).toString('ascii');
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    const chunkEnd = dataEnd + 4;
    if (chunkEnd > pngBuffer.length) break;

    if (type === 'tEXt') {
      const data = pngBuffer.subarray(dataStart, dataEnd);
      const separator = data.indexOf(0);
      if (separator > 0) {
        const keyword = data.subarray(0, separator).toString('latin1');
        if (keyword === 'chara' || keyword === 'ccv3') {
          const encoded = data.subarray(separator + 1).toString('utf8').trim();
          return JSON.parse(Buffer.from(encoded, 'base64').toString('utf8'));
        }
      }
    }

    offset = chunkEnd;
  }

  throw new Error('PNG 中没有角色卡数据');
}

export async function writeCardPng({ avatarDataUrl, cardJson, outputPath }) {
  const avatar = dataUrlToBuffer(avatarDataUrl);
  const output = embedCardInPng(avatar, cardJson);
  await fs.writeFile(outputPath, output);
  return outputPath;
}
