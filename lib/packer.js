import assert from 'assert';
import common from '../prelude/common.js';
import fs from 'fs-promise';
import { log } from './log.js';
import { version } from '../package.json';

const STORE_CODE = common.STORE_CODE;
const STORE_CONTENT = common.STORE_CONTENT;
const STORE_LINKS = common.STORE_LINKS;
const STORE_STAT = common.STORE_STAT;

const isDotJS = common.isDotJS;
const isDotJSON = common.isDotJSON;
const snapshotify = common.snapshotify;

const bootstrapText = fs.readFileSync(
  require.resolve('../prelude/bootstrap.js'), 'utf8'
).replace('%PKG_VERSION%', version);

const commonText = fs.readFileSync(
  require.resolve('../prelude/common.js'), 'utf8'
);

function itemsToText (items) {
  const len = items.length;
  return len.toString() +
    (len % 10 === 1 ? ' item' : ' items');
}

function reduceRecords (records) {
  assert(Array.isArray(records), 'packer: bad records to reduce');
  const result = {};

  records.some(function (record) {
    if (record.discard) return;
    const file = record.file;
    if (!result[file]) result[file] = {};
    result[file][record.store] = record.body;
  });

  return result;
}

export default async function (opts) {
  const records = reduceRecords(opts.records);
  const statsOfRecords = {};
  const stripe = [];
  let stripeLength = 0;
  const vfs = {};

  function write (w, item) {
    const vfsrs = { s: stripeLength, w };
    stripe.push(item);
    stripeLength += w;
    return vfsrs;
  }

  log.warn('TODO IMPLEMENT logging from packer');

  for (const file in records) {
    statsOfRecords[file] = await fs.stat(file);
  }

  for (const file in records) {
    const record = records[file];
    const snap = snapshotify(file, opts.slash);
    const vfsr = vfs[snap] = {};
    assert(record[STORE_STAT], 'packer: no STORE_STAT');

    if ((typeof record[STORE_CODE] !== 'undefined') &&
        (typeof record[STORE_CONTENT] !== 'undefined')) {
      delete record[STORE_CODE];
    }

    for (const store of [ STORE_CODE, STORE_CONTENT, STORE_LINKS, STORE_STAT ]) {
      const value = record[store];
      if (typeof value === 'undefined') continue;

      if (store === STORE_CODE) {
        if (value.directly) {
          const w = statsOfRecords[file].size;
          vfsr[store] = write(w, { store, file });
        } else
        if (typeof value === 'string') {
          const buffer = new Buffer(value);
          vfsr[store] = write(buffer.length, { store, buffer });
        } else {
          assert(false, 'packer: bad STORE_CODE');
        }
      } else
      if (store === STORE_CONTENT) {
        if (value.directly) {
          const w = statsOfRecords[file].size;
          vfsr[store] = write(w, { store, file });
        } else
        if (Buffer.isBuffer(value)) {
          const buffer = value;
          vfsr[store] = write(buffer.length, { store, buffer });
        } else
        if (typeof value === 'string') {
          const buffer = new Buffer(value);
          vfsr[store] = write(buffer.length, { store, buffer });
        } else {
          assert(false, 'packer: bad STORE_CONTENT');
        }
      } else
      if (store === STORE_LINKS) {
        if (Array.isArray(value)) {
          const buffer = new Buffer(JSON.stringify(value));
          vfsr[store] = write(buffer.length, { store, buffer });
        } else {
          assert(false, 'packer: bad STORE_LINKS');
        }
      } else
      if (store === STORE_STAT) {
        if (value.directly) {
          const stat = statsOfRecords[file];
          assert(typeof stat === 'object', 'packer: bad stat');
          const newStat = Object.assign({}, stat);
          newStat.atime = stat.atime.getTime();
          newStat.mtime = stat.mtime.getTime();
          newStat.ctime = stat.ctime.getTime();
          newStat.birthtime = stat.birthtime.getTime();
          newStat.isFileValue = stat.isFile();
          newStat.isDirectoryValue = stat.isDirectory();

          const buffer = new Buffer(JSON.stringify(newStat));
          vfsr[store] = write(buffer.length, { store, buffer });
        } else {
          assert(false, 'packer: bad STORE_LINKS');
        }
      } else {
        assert(false, 'packer: unknown store');
      }
    }
  }

  let entrypoint;

  for (const record of opts.records) {
    if (record.entrypoint) {
      entrypoint = snapshotify(record.file, opts.slash);
      break;
    }
  }

  const prelude =
    '(function (REQUIRE_COMMON, VIRTUAL_FILESYSTEM, DEFAULT_ENTRYPOINT) {\n' +
      bootstrapText +
    '\n})(function (exports) {\n' +
      commonText +
    '\n},\n' +
      JSON.stringify(vfs) +
    '\n,\n' +
      JSON.stringify(entrypoint) +
    '\n)';

  return { prelude, stripe };
};
