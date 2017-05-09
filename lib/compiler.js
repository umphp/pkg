import { spawn } from 'child_process';

// TODO speedup by reusing fabricator process

const script = `
  var stdin = new Buffer(0);
  process.stdin.on('data', function (data) {
    stdin = Buffer.concat([ stdin, data ]);
  });
  process.stdin.on('end', function (data) {
    var vm = require('vm');
    stdin = require('module').wrap(stdin);
    var s = new vm.Script(stdin, {
      produceCachedData: true,
      sourceless: true
    });
    if (!s.cachedDataProduced) {
      console.error('Pkg: Cached data not produced.');
      process.exit(2);
    }
    process.stdout.write(s.cachedData);
  });
  process.stdin.resume();
`;

export default function (options, target, buffer, cb) {
  const cmd = target.fabricator.binaryPath;
  let stdout = new Buffer(0);

  const child = spawn(
    cmd, [ '-e', script, '--runtime' ].concat(options),
    { stdio: [ 'pipe', 'pipe', 'inherit' ] }
  );

  child.on('error', (error) => {
    cb(error);
  }).on('close', (code) => {
    if (code !== 0) {
      return cb(new Error(`${cmd} failed with code ${code}`));
    }
    cb(undefined, stdout);
  });

  child.stdin.on('error', (error) => {
    if (error.code === 'EPIPE') {
      return cb(new Error(`Was not able to compile for '${JSON.stringify(target)}'`));
    }
    cb(error);
  });

  child.stdout.on('data', function (data) {
    stdout = Buffer.concat([ stdout, data ]);
  });

  child.stdin.end(buffer);
}
