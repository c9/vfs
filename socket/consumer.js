var socketTransport = require('architect-socket-transport');
var Agent = require('architect-agent').Agent;
var Stream = require('stream').Stream;
var EventEmitter = require('events').EventEmitter;

// @fsOptions can have:
//   fsOptions.input - input stream
//   fsOptions.output - output stream (reuses input if not given)
//   fsOptions.callback - get's called with the remote once connected
module.exports = function setup(fsOptions, callback) {
    var input = fsOptions.input;
    if (!(input instanceof Stream && input.readable !== false)) throw new TypeError("input must be a readable Stream");
    var output = fsOptions.hasOwnProperty("output") ? fsOptions.output : input;
    if (!(output instanceof Stream && output.writable !== false)) throw new TypeError("output must be a writable Stream");

    var proxyStreams = {}; // Stream proxies given us by the other side
    var proxyProcesses = {};
    var remote;

    // options.id, options.readable, options.writable
    function makeStreamProxy(token) {
        var stream = new Stream();
        var id = token.id;
        stream.id = id;
        proxyStreams[id] = stream;
        if (token.hasOwnProperty("readable")) stream.readable = token.readable;
        if (token.hasOwnProperty("writable")) stream.writable = token.writable;

        if (stream.writable) {
            stream.write = function (chunk) {
                var ret = remote.send(["write", id, chunk], function () {
                    if (ret === false) stream.emit("drain");
                });
                return ret;
            };
            stream.end = function (chunk) {
                if (chunk) remote.end(id, chunk)
                else remote.end(id);
            };
        }
        if (stream.readable) {
            stream.destroy = function () {
                remote.destroy(id);
            };
        }

        return stream;
    }

    function makeProcessProxy(token) {
        var process = new EventEmitter();
        var pid = token.pid;
        process.pid = pid;
        proxyProcesses[pid] = process;
        process.stdout = makeStreamProxy(token.stdout);
        process.stderr = makeStreamProxy(token.stderr);
        process.stdin = makeStreamProxy(token.stdin);
        process.kill = function (signal) {
            remote.kill(pid, signal);
        };
        return process;
    }

    function onExit(pid, code, signal) {
        var process = proxyProcesses[pid];
        process.emit("exit", code, signal);
        delete proxyProcesses[pid];
        delete proxyStreams[process.stdout.id];
        delete proxyStreams[process.stderr.id];
        delete proxyStreams[process.stdin.id];
    }

    // Remote readable stream emitting to local proxy stream
    function onData(id, chunk) {
        var stream = proxyStreams[id];
        stream.emit("data", chunk);
    }
    function onEnd(id) {
        var stream = proxyStreams[id];
        stream.emit("end");
        delete proxyStreams[id];
    }
    function onClose(id) {
        var stream = proxyStreams[id];
        if (!stream) return;
        stream.emit("close");
        delete proxyStreams[id];
    }

    var agent = new Agent({
        onExit: onExit,
        onData: onData,
        onEnd: onEnd,
        onClose: onClose
    });

    // Load the worker vfs using the socket.
    agent.attach(socketTransport(input, output), function (worker) {
        remote = worker;
        if (callback) callback(null, vfs);
    });

    // Return fake endpoints in the initial return till we have the real ones.
    function route(name) {
        return function (path, options, callback) {
            if (remote) {
                return remote[name].call(this, path, options, function (err, meta) {
                    if (err) return callback(err);
                    if (meta.stream) {
                        meta.stream = makeStreamProxy(meta.stream);
                    }
                    if (meta.process) {
                        meta.process = makeProcessProxy(meta.process);
                    }
                    return callback(null, meta);
                });
            }
            var err = new Error("VFS not Ready yet");
            err.code = "ENOTREADY";
            callback(err);
        }
    }
    function ping(callback) {
        if (remote) {
            return remote.ping(callback);
        }
        var err = new Error("VFS not Ready yet");
        err.code = "ENOTREADY";
        callback(err);
    }

    var vfs = {
        ping: ping,
        spawn: route("spawn"),
        exec: route("exec"),
        connect: route("connect"),
        readfile: route("readfile"),
        mkfile: route("mkfile"),
        rmfile: route("rmfile"),
        readdir: route("readdir"),
        stat: route("stat"),
        mkdir: route("mkdir"),
        rmdir: route("rmdir"),
        rename: route("rename"),
        copy: route("copy"),
        symlink: route("symlink")
    };
    return vfs;
};