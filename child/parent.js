var consumer = require('vfs-socket/consumer');
var spawn = require('child_process').spawn;
var Pipe;

// Simple vfs that uses vfs-socket over a parent-child process relationship
module.exports = function setup(fsOptions, callback) {
    if (!Pipe) Pipe = process.binding('pipe_wrap').Pipe;
    var options = { customFds: [-1, 1, 2], stdinStream: new Pipe(true) };
    if (fsOptions.hasOwnProperty("gid")) {
        options.gid = fsOptions.gid;
        delete fsOptions.gid;
    }
    if (fsOptions.hasOwnProperty("uid")) {
        options.uid = fsOptions.uid;
        delete fsOptions.uid;
    }
    var args = [require.resolve('./child.js'), JSON.stringify(fsOptions)];
    var executablePath = process.execPath;

    var child = spawn(executablePath, args, options);

    child.stdin.resume();
    child.stdin.readable = true;

    var remote = consumer({input: child.stdin}, function (err, remote) {
      if (callback) callback(err, remote);
    });
    return remote;
}