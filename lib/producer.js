import bufferStream from 'simple-bufferstream';
import fs from 'fs';
import multistream from 'multistream';

const prepend = '(function(process, require, console, EXECPATH_FD, PAYLOAD_BASE) {\n';
const append = '\n})'; // dont remove \n
const boundary = 4096;

function paddingBuffer (size) {
  const remainder = size % boundary;
  const padding = (remainder === 0 ? 0 : boundary - remainder);
  return Buffer.alloc(padding);
}

function makeBakeryBoxFromOptions (options) {
  const parts = [];
  for (let i = 0; i < options.length; i += 1) {
    parts.push(Buffer.from(options[i]));
    parts.push(Buffer.alloc(1));
  }
  parts.push(Buffer.alloc(1));
  const buffer = Buffer.concat(parts);

  const sentinel = new Buffer(16);
  sentinel.writeInt32LE(0x4818c4df, 0);
  sentinel.writeInt32LE(0x7ac30670, 4);
  sentinel.writeInt32LE(0x56558a76, 8);
  sentinel.writeInt32LE(buffer.length, 12);
  return Buffer.concat([ sentinel, buffer ]);
}

function makePreludeBoxFromPrelude (prelude) {
  const buffer = new Buffer(prepend + prelude + append);
  const sentinel = new Buffer(16);
  sentinel.writeInt32LE(0x26e0c928, 0);
  sentinel.writeInt32LE(0x41f32b66, 4);
  sentinel.writeInt32LE(0x3ea13ccf, 8);
  sentinel.writeInt32LE(buffer.length, 12);
  return Buffer.concat([ sentinel, buffer ]);
}

function makePayloadBoxFromStripe () {
  const buffer = new Buffer([ 0x55, 0x55, 0x55, 0x55 ]);
  const sentinel = new Buffer(16);
  sentinel.writeInt32LE(0x75148eba, 0);
  sentinel.writeInt32LE(0x6fbda9b4, 4);
  sentinel.writeInt32LE(0x2e20c08d, 8);
  sentinel.writeInt32LE(0, 12); // PKG_PAYLOAD_SIZE
  return Buffer.concat([ sentinel, buffer ]);
}

export default function ({ backpack, options, target }) {
  return new Promise((resolve, reject) => {
    const { prelude, stripe } = backpack;
    const { size } = fs.statSync(target.binaryPath);
    const bakeryBox = makeBakeryBoxFromOptions(options);
    const preludeBox = makePreludeBoxFromPrelude(prelude);
    const payloadBox = makePayloadBoxFromStripe(stripe);

    multistream([
      fs.createReadStream(target.binaryPath),
      () => bufferStream(paddingBuffer(size)),
      () => bufferStream(bakeryBox),
      () => bufferStream(paddingBuffer(bakeryBox.length)),
      () => bufferStream(preludeBox),
      () => bufferStream(paddingBuffer(preludeBox.length)),
      () => bufferStream(payloadBox),
      () => bufferStream(paddingBuffer(payloadBox.length))
    ]).pipe(
      fs.createWriteStream(target.output)
    ).on('error', (error) => {
      reject(error);
    }).on('close', () => {
      resolve();
    });
  });
}
