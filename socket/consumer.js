( // Module boilerplate to support browser globals, node.js and AMD.
  (typeof module === "object" && function (m) { module.exports = m(require('stream'), require('events'), require('smith')); }) ||
  (typeof define === "function" && function (m) { define("vfs-socket/consumer", ["stream", "events", "smith"], m); }) ||
  (function (m) { window.consumer = m(window.stream, window.events, window.smith); })
)(function (stream, events, smith) {
"use strict";

var exports = {};

var Stream = stream.Stream;
var EventEmitter = events.EventEmitter;
var Agent = smith.Agent;

exports.smith = smith;
exports.Consumer = Consumer;

function inherits(Child, Parent) {
    Child.super_ = Parent;
    Child.prototype = Object.create(Parent.prototype, {
        constructor: { value: Child }
    });
}

function Consumer() {

    Agent.call(this, {

        // Endpoints for readable streams in meta.stream (and meta.process.{stdout,stderr})
        onData: onData,
        onEnd: onEnd,

        // Endpoint for writable stream at meta.stream (and meta.process.stdin)
        onClose: onClose,

        // Endpoints for writable streams at options.stream
        write: write,
        end: end,

        // Endpoint for readable streams at options.stream
        destroy: destroy,

        // Endpoint for processes in meta.process
        onExit: onExit,

        // Endpoint for watchers in meta.watcher
        onChange: onChange,

        // Endpoint for the remote vfs itself
        onEvent: onEvent
    });

    var streams = {}; // streams sent in options.stream
    var proxyStreams = {}; // Stream proxies given us by the other side
    var proxyProcesses = {}; // Process proxies given us by the other side
    var proxyWatchers = {}; // Watcher proxies given us by the other side
    var proxyApis = {};
    var handlers = {}; // local handlers for remote events
    var pendingOn = {}; // queue for pending on handlers.
    var pendingOff = {}; // queue for pending off handlers.

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
        realpath: route("realpath"),
        watch: route("watch"),
        changedSince: route("changedSince"),
        extend: route("extend"),
        emit: emit,
        on: on,
        off: off
    };
    var remote = this.remoteApi;

    // Resume readable streams that we paused when the channel drains
    // Forward drain events to all the writable proxy streams.
    this.on("drain", function () {
        Object.keys(streams).forEach(function (id) {
            var stream = streams[id];
            if (stream.readable && stream.resume) stream.resume();
        });
        Object.keys(proxyStreams).forEach(function (id) {
            var stream = proxyStreams[id];
            if (stream.writable) stream.emit("drain");
        });
    });

    var nextStreamID = 1;
    function storeStream(stream) {
        while (streams.hasOwnProperty(nextStreamID)) { nextStreamID++; }
        var id = nextStreamID;
        streams[id] = stream;
        stream.id = id;
        if (stream.readable) {
            stream.on("data", function (chunk) {
                if (remote.onData(id, chunk) === false) {
                    stream.pause();
                }
            });
            stream.on("end", function () {
                remote.onEnd(id);
                delete streams[id];
                nextID = id;
            });
        }
        if (stream.writable) {
            stream.on("close", function () {
                remote.onClose(id);
                delete streams[id];
                nextID = id;
            });
        }
        var token = {id: id};
        if (stream.hasOwnProperty("readable")) token.readable = stream.readable;
        if (stream.hasOwnProperty("writable")) token.writable = stream.writable;
        return token;
    }


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

    function makeApiProxy(token) {
        var name = token.name;
        var api = proxyApis[name] = new EventEmitter();
        api.name = token.name;
        api.names = token.names;
        token.names.forEach(function (functionName) {
            api[functionName] = function () {
                remote.call(name, functionName, Array.prototype.slice.call(arguments));
            };
        });
        return api;
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

    // For routing events from remote vfs to local listeners.
    function onEvent(name, value) {
        var list = handlers[name];
        if (!list) return;
        for (var i = 0, l = list.length; i < l; i++) {
            list[i](value);
        }
    }

    function write(id, chunk) {
        // They want to write to our real stream
        var stream = streams[id];
        stream.write(chunk);
    }
    function destroy(id) {
        var stream = streams[id];
        if (!stream) return;
        stream.destroy();
        delete streams[id];
        nextID = id;
    }
    function pause(id) {
        var stream = streams[id];
        if (!stream) return;
        stream.pause();
    }
    function resume(id) {
        var stream = streams[id];
        if (!stream) return;
        stream.resume();
    }
    function end(id, chunk) {
        var stream = streams[id];
        if (!stream) return;
        if (chunk)
            stream.end(chunk);
        else
            stream.end();
        delete streams[id];
        nextID = id;
    }


    function on(name, handler, callback) {
        if (handlers[name]) {
            handlers[name].push(handler);
            if (pendingOn[name]) {
                callback && pendingOn[name].push(callback);
                return;
            }
            return callback();
        }
        handlers[name] = [handler];
        var pending = pendingOn[name] = [];
        callback && pending.push(callback);
        return remote.subscribe(name, function (err) {
            for (var i = 0, l = pending.length; i < l; i++) {
                pending[i](err);
            }
            delete pendingOn[name];
        });
    }

    function off(name, handler, callback) {
        if (pendingOff[name]) {
            callback && pendingOff[name].push(callback);
            return;
        }
        if (!handlers[name]) {
            return callback();
        }
        var pending = pendingOff[name] = [];
        callback && pending.push(callback);
        return remote.unsubscribe(name, function (err) {
            delete handlers[name];
            for (var i = 0, l = pending.length; i < l; i++) {
                pending[i](err);
            }
            delete pendingOff[name];
        });
    }

    function emit() {
        remote.emit.apply(this, arguments);
    }

    // Return fake endpoints in the initial return till we have the real ones.
    function route(name) {
        return function (path, options, callback) {
            if (!callback) throw new Error("Forgot to pass in callback for " + name);
            if (options.stream) {
                options.stream = storeStream(options.stream);
            }
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
                if (meta.api) {
                    meta.api = makeApiProxy(meta.api);
                }

                return callback(null, meta);
            });
        };
    }
    function ping(callback) {
        return remote.ping(callback);
    }


}
inherits(Consumer, Agent);

// Emit the wrapped API, not the raw one
Consumer.prototype._emitConnect = function () {
    this.emit("connect", this.vfs);
};

return exports;

});