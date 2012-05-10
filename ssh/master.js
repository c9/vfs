var spawn = require('child_process').spawn;
var embedderSync = require('embedder-sync');
var consumer = require('vfs-socket/consumer');

// This is the function to be bootstrapped on the remote node command
var bootstrap = ("(" + function () {
  // We don't want to send text on stdout
  console.log = console.error;
  var code = "";
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
      code += chunk.toString("utf8");
      return;
    }
    if (end > 0) {
      code += chunk.toString("utf8", 0, end);
    }
    var left = chunk.slice(end + 1);

    // Stop reading code and execute the code
    process.stdin.removeListener("data", onChunk);
    // process.title = "node generated.js";

    try {
        require("vm").runInNewContext(code, {
          require: require,
          Buffer: Buffer,
          process: process,
          console: console
        }, "generated.js");
    } catch (err) {
        console.error(err.stack);
    }
    if (left.length) process.stdin.emit("data", left);
  }

  // Start reading the code
  process.stdin.on("data", onChunk);
  process.stdin.resume();

} + ")();").replace(new RegExp("//.*\n", "g"), "").replace(/[\n ]+/ig, "\n");

var libCode = embedderSync(__dirname, ["vfs-socket", "vfs-socket/worker", "./slave"], true);

// Simple vfs that uses vfs-socket over a ssh tunnel to a remote node process
module.exports = function setup(fsOptions, callback) {
    var nodePath = fsOptions.nodePath || "/usr/local/bin/node";

    var host = fsOptions.host; // Username can just go in host since it's passed to ssh as-is
    if (!host) throw new Error("host is a required option in vfs-ssh");

    if (fsOptions.pingInterval) setTimeout(doPing, fsOptions.pingInterval);
    function doPing() {
      remote.ping(function (err) {
        if (err) console.error(err.stack);
        setTimeout(doPing, fsOptions.pingInterval);
      });
    }

    // Send bootstrap on command line
    var args = [host];

    var sshOptions = {
      BatchMode: "yes",
    }

    // see `man ssh_config` to see what options are avaialble
    // Mix in user specified options overrides
    if (fsOptions.sshOptions) {
      for (var key in fsOptions.sshOptions) {
        sshOptions[key] = fsOptions.sshOptions[key];
      }
    }

    for (key in sshOptions) {
      args.push("-o", key + "=" + sshOptions[key]);
    }

    args.push(nodePath + " -e '" + bootstrap + "'");

    var child = spawn("ssh", args);
    // Forward stderr data for easy debugging
    child.stderr.pipe(process.stderr, {end: false});

    var code = libCode + "\nrequire('vfs-ssh/slave')(" + JSON.stringify(fsOptions) + ");\n";
    child.stdin.write(code + "\0");

    var stdoutChunks = [];
    var stderrChunks = [];
    function captureStdout(chunk) {
      stdoutChunks.push(chunk);
    }
    function captureStderr(chunk) {
      stderrChunks.push(chunk);
    }

    child.stdout.on("data", captureStdout);
    child.stderr.on("data", captureStderr);

    var done;
    child.on("exit", function (code, signal) {
      if (done) return;
      var stdout = stdoutChunks.join("").trim();
      var stderr = stderrChunks.join("").trim();
      child.stdout && child.stdout.removeListener("data", captureStdout);
      child.stderr && child.stderr.removeListener("data", captureStderr);
      done = true;
      var err = new Error("ssh process died");
      if (signal) {
        err.message += " because of signal " + signal;
        err.signal = signal;
      }
      if (code) {
        err.message += " with exit code " + code;
        err.exitCode = code;
      }
      if (stdout) {
        err.message += "\n" + stdout;
        err.stdout = stdout;
      }
      if (stderr) {
        err.message += "\n" + stderr;
        err.stderr = stderr;
      }
      callback(err);
    });

    var remote = consumer({input: child.stdout, output: child.stdin}, function (err, remote) {
      if (done) return;
      child.stdout.removeListener("data", captureStdout);
      done = true;
      if (err) return callback(err);
      if (callback) callback(null, remote);
    });
    return remote;
}

