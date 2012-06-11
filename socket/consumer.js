var Stream = require('stream').Stream;
var EventEmitter = require('events').EventEmitter;
var inherits = require('util').inherits;
var Agent = require('smith').Agent;

exports.Consumer = Consumer;

function Consumer() {

    Agent.call(this, {
        onExit: onExit,
        onData: onData,
        onEnd: onEnd,
        onClose: onClose,
        onChange: onChange,
    });

    var proxyStreams = {}; // Stream proxies given us by the other side
    var proxyProcesses = {}; // Process proxies given us by the other side
    var proxyWatchers = {}; // Watcher proxies given us by the other side

    this.vfs = {
        ping: ping, // Send a simple ping request to the worker
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
        symlink: route("symlink"),
        watch: route("watch"),
        changedSince: route("changedSince"),
    }
    var remote = this.remoteApi;

    // Forward drain events to all the writable streams.
    this.on("drain", function () {
        Object.keys(proxyStreams).forEach(function (id) {
            var stream = proxyStreams[id];
            if (stream.writable) stream.emit("drain");
        });
    })

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
                return remote.write(id, chunk);
            };
            stream.end = function (chunk) {
                if (chunk) remote.end(id, chunk);
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

    function makeWatcherProxy(token) {
        var watcher = new EventEmitter();
        var id = token.id;
        watcher.id = id;
        proxyWatchers[id] = watcher;
        watcher.close = function () {
            remote.close(id);
            delete proxyWatchers[id];
        };
        return watcher;
    }

    function onExit(pid, code, signal) {
        var process = proxyProcesses[pid];
        process.emit("exit", code, signal);
        delete proxyProcesses[pid];
        delete proxyStreams[process.stdout.id];
        delete proxyStreams[process.stderr.id];
        delete proxyStreams[process.stdin.id];
    }
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

    function onChange(id, event, filename) {
        var watcher = proxyWatchers[id];
        if (!watcher) return;
        watcher.emit("change", event, filename);
    }

    // Return fake endpoints in the initial return till we have the real ones.
    function route(name) {
        return function (path, options, callback) {
            return remote[name].call(this, path, options, function (err, meta) {
                if (err) return callback(err);
                if (meta.stream) {
                    meta.stream = makeStreamProxy(meta.stream);
                }
                if (meta.process) {
                    meta.process = makeProcessProxy(meta.process);
                }
                if (meta.watcher) {
                    meta.watcher = makeWatcherProxy(meta.watcher);
                }
                return callback(null, meta);
            });
        }
    }
    function ping(callback) {
        return remote.ping(callback);
    }


}
inherits(Consumer, Agent);

// Emit the wrapped API, not the raw one
Consumer.prototype._emitConnect = function () {
    this.emit("connect", this.vfs);
}

