var spawn = require('child_process').spawn;
var embedderSync = require('embedder-sync');
var consumer = require('vfs-socket/consumer');

// This is the function to be bootstrapped on the remote node command
var bootstrap = ("(" + function () {
  // We don't want to send text on stdout
  console.log = console.error;
  var code = '';
  function onChunk(chunk) {
    var end = -1;
    // Scan for null byte
    for (var i = 0, l = chunk.length; i < l; i++) {
      if (chunk[i] === 0) {
        end = i;
        break;
      }
    }
    if (end < 0) {
      code += chunk.toString('utf8');
      return;
    }
    if (end > 0) {
      code += chunk.toString('utf8', 0, end);
    }
    var left = chunk.slice(end + 1);

    // Stop reading code and execute the code
    process.stdin.removeListener('data', onChunk);
    // process.title = "node generated.js";

    try {
        require('vm').runInNewContext(code, {
          require: require,
          Buffer: Buffer,
          process: process,
          console: console
        }, 'generated.js');
    } catch (err) {
        console.error(err.stack);
    }
    if (left.length) process.stdin.emit('data', left);
  }

  // Start reading the code
  process.stdin.on('data', onChunk);
  process.stdin.resume();

} + ")();").replace(new RegExp("//.*\n", "g"), "").replace(/"/g, '\\"').replace(/[\n ]+/ig, " ");

var libCode = embedderSync(__dirname, ["vfs-socket", "vfs-socket/worker", "./slave"], true);

// Simple vfs that uses vfs-socket over a ssh tunnel to a remote node process
module.exports = function setup(fsOptions) {
    var nodePath = fsOptions.nodePath || "/usr/local/bin/node";

    var host = fsOptions.host; // Username can just go in host since it's passed to ssh as-is
    if (!host) throw new Error("host is a required option in vfs-ssh");
    
    // Send bootstrap on command line
    var args = [host];
    // A specific key may be passed in
    if (fsOptions.key) {
      args.push("-i");
      args.push(options.key);
    }
    args.push("-C");
    args.push(nodePath + ' -e "' + bootstrap + '"');

    // Share stderr with parent to enable debugging
    var options = { customFds: [-1, -1, 2] };

    var child = spawn("ssh", args, options);

    var code = libCode + "\nrequire('vfs-ssh/slave')(" + JSON.stringify(fsOptions) + ");\n";
    child.stdin.write(code + "\0");

    return consumer({input: child.stdout, output: child.stdin});
}

