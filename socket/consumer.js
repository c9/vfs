var socketTransport = require('architect-socket-transport');
var Agent = require('architect-agent').Agent;
var Stream = require('stream').Stream;

// @fsOptions can have:
//   fsOptions.input - input stream
//   fsOptions.output - output stream (reuses input if not given)
//   fsOptions.callback - get's called with the remote once connected
module.exports = function setup(fsOptions) {
    var input = fsOptions.input;
    if (!(input instanceof Stream && input.readable !== false)) throw new TypeError("input must be a readable Stream");
    var output = fsOptions.hasOwnProperty("output") ? fsOptions.output : input;
    if (!(output instanceof Stream && output.writable !== false)) throw new TypeError("output must be a writable Stream");

    var proxyStreams = {}; // Stream proxies given us by the other side

    // options.id, options.readable, options.writable
    function makeStreamProxy(token) {
        var stream = new Stream();
        var id = token.id;
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
                delete proxyStreams[id];
            };
        }

        return stream;
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
    
    var agent = new Agent({
        onData: onData,
        onEnd: onEnd
    });

    // Load the worker vfs using the socket.
    var vfs;
    agent.attach(socketTransport(input, output), function (worker) {
        vfs = worker;
        if (fsOptions.callback) fsOptions.callback(worker);
    });

    // Return fake endpoints in the initial return till we have the real ones.
    function route(name) {
        return function (path, options, callback) {
            if (vfs) {
                return vfs[name].call(this, path, options, function (err, meta) {
                    if (err) return callback(err);
                    if (meta.stream) {
                        meta.stream = makeStreamProxy(meta.stream);
                    }
                    return callback(null, meta);
                });
            }
            var err = new Error("VFS not Ready yet");
            err.code = "ENOTREADY";
            callback(err);
        }
    }
    return {
        readfile: route("readfile"),
        mkfile: route("mkfile"),
        rmfile: route("rmfile"),
        readdir: route("readdir"),
        mkdir: route("mkdir"),
        rmdir: route("rmdir"),
        rename: route("rename"),
        copy: route("copy"),
        symlink: route("symlink")
    };
};