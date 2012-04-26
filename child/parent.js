var consumer = require('vfs-socket/consumer');
var spawn = require('child_process').spawn;
var Pipe;

// Simple vfs that uses vfs-socket over a parent-child process relationship
module.exports = function setup(fsOptions) {
    if (!Pipe) Pipe = process.binding('pipe_wrap').Pipe;
    var options = { customFds: [-1, 1, 2], stdinStream: new Pipe(true) };
    var args = [require.resolve('./child.js'), JSON.stringify(fsOptions)];
    var executablePath = process.execPath;

    var child = spawn(executablePath, args, options);
    child.stdin.resume();
    child.stdin.readable = true;
    return consumer({input: child.stdin});
}