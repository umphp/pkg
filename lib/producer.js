import assert from 'assert';
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

function makePayloadHeader () {
  const sentinel = new Buffer(16);
  sentinel.writeInt32LE(0x75148eba, 0);
  sentinel.writeInt32LE(0x6fbda9b4, 4);
  sentinel.writeInt32LE(0x2e20c08d, 8);
  sentinel.writeInt32LE(0, 12); // PKG_PAYLOAD_SIZE
  return sentinel;
}

export default function ({ backpack, options, target }) {
  return new Promise((resolve, reject) => {
    const { prelude, stripe } = backpack;
    const { size } = fs.statSync(target.binaryPath);
    const bakeryBox = makeBakeryBoxFromOptions(options);
    const preludeBox = makePreludeBoxFromPrelude(prelude);
    const payloadHeader = makePayloadHeader(stripe);

    const beforeStripe = [
      target.binaryPath,
      paddingBuffer(size),
      bakeryBox,
      paddingBuffer(bakeryBox.length),
      payloadHeader
    ];

    const afterStripe = [
      preludeBox,
      paddingBuffer(preludeBox.length)
    ];

    multistream((cb) => {
      if (beforeStripe.length) {
        const item = beforeStripe.shift();
        if (typeof item === 'string') {
          return cb(null, fs.createReadStream(item));
        } else {
          return cb(null, bufferStream(item));
        }
      } else
      if (stripe.length) {
        const item = stripe.shift();
        // TODO distinguish store to make cachedData
        if (item.file) {
          return cb(null, fs.createReadStream(item.file));
        } else
        if (item.buffer) {
          return cb(null, bufferStream(item.buffer));
        } else {
          assert(false, 'producer: bad stripe item');
        }
      } else
      if (afterStripe.length) {
        const item = afterStripe.shift();
        if (typeof item === 'string') {
          return cb(null, fs.createReadStream(item));
        } else {
          return cb(null, bufferStream(item));
        }
      } else {
        return cb(null, null);
      }
    }).pipe(
      fs.createWriteStream(target.output)
    ).on('error', (error) => {
      reject(error);
    }).on('close', () => {
      resolve();
    });
  });
}
