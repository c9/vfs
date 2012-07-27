var inherits = require('util').inherits;
var smith = require('smith');
var Agent = smith.Agent;
var Stream = require('stream').Stream;

exports.smith = smith;

exports.Worker = Worker;

// Worker is a smith.Agent that wraps the vfs api passed to it.  It's works in
// tandem with Consumer agents on the other side.
function Worker(vfs) {
    Agent.call(this, {

        // Endpoints for writable streams at meta.stream (and meta.process.stdin)
        write: write,
        end: end,

        // Endpoint for readable stream at meta.stream (and meta.process.{stdout,stderr})
        destroy: destroy,

        // Endpoints for readable streams at options.stream
        onData: onData,
        onEnd: onEnd,

        // Endpoint for writable streams at options.stream
        onClose: onClose,

        // Endpoints for processes at meta.process
        kill: kill,

        // Endpoint for watchers at meta.watcher
        close: close,

        // Endpoint for apis at meta.api
        call: call,

        // Endpoints for vfs itself
        subscribe: subscribe,
        unsubscribe: unsubscribe,
        emit: vfs.emit,

        // special vfs-socket api
        ping: ping,

        // Route other calls to the local vfs instance
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
        extend: route("extend")
    });

    var proxyStreams = {};
    var streams = {};
    var watchers = {};
    var processes = {};
    var apis = {};
    var handlers = {};
    var remote = this.remoteApi;

    function subscribe(name, callback) {
        handlers[name] = function (value) {
            remote.onEvent(name, value);
        }
        vfs.on(name, handlers[name], callback);
    }

    function unsubscribe(name, callback) {
        if (!handlers[name]) return;
        vfs.off(name, handlers[name], callback);
        delete handlers[name];
    }

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

    function storeProcess(process) {
        var pid = process.pid;
        processes[pid] = process;
        process.on("exit", function (code, signal) {
            remote.onExit(pid, code, signal);
            delete processes[pid];
            delete streams[process.stdout.id];
            delete streams[process.stderr.id];
            delete streams[process.stdin.id];
        });
        var token = {pid: pid};
        token.stdin = storeStream(process.stdin);
        token.stdout = storeStream(process.stdout);
        token.stderr = storeStream(process.stderr);
        return token;
    }

    var nextWatcherID = 1;
    function storeWatcher(watcher) {
        while (watchers.hasOwnProperty(nextWatcherID)) { nextWatcherID++; }
        var id = nextWatcherID;
        watchers[id] = watcher;
        watcher.id = id;
        watcher.on("change", function (event, filename) {
            remote.onChange(id, event, filename);
        });
        var token = {id: id};
        return token;
    }

    function storeApi(api) {
        var name = api.name;
        apis[name] = api;
        var token = { name: name, names: api.names };
        return token;
    }

    // Remote side writing to our local writable streams
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

    function kill(pid, code) {
        var process = processes[pid];
        process.kill(code);
    }

    function close(id) {
        var watcher = watchers[id];
        delete watchers[id];
        watcher.close();
    }

    function call(name, fnName, args) {
        var api = apis[name];
        if (!api) return;
        api[fnName].apply(api, args);
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

    // Can be used for keepalive checks.
    function ping(callback) {
        callback();
    }

    function route(name) {
        var fn = vfs[name];
        return function wrapped(path, options, callback) {
            if (typeof callback !== "function") {
                throw new Error(name + ": callback must be function");
            }
            // Call the real local function, but intercept the callback
            if (options.stream) {
                options.stream = makeStreamProxy(options.stream);
            }
            fn(path, options, function (err, meta) {
                // Make error objects serializable
                if (err) {
                    var nerr = {
                        stack: process.pid + ": " + err.stack
                    };
                    if (err.hasOwnProperty("code")) nerr.code = err.code;
                    if (err.hasOwnProperty("message")) nerr.message = err.message;
                    return callback(nerr);
                }
                // Replace streams with tokens
                if (meta.stream) {
                    meta.stream = storeStream(meta.stream);
                }
                if (meta.process) {
                    meta.process = storeProcess(meta.process);
                }
                if (meta.watcher) {
                    meta.watcher = storeWatcher(meta.watcher);
                }
                if (meta.api) {
                    meta.api = storeApi(meta.api);
                }
                // Call the remote callback with the result
                callback(null, meta);
            });
        };
    }
}
inherits(Worker, Agent);
