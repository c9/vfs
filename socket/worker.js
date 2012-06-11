var Stream = require('stream').Stream;
var inherits = require('util').inherits;
var Agent = require('smith').Agent;

exports.Worker = Worker;

// Worker is a smith.Agent that wraps the vfs api passed to it.  It's works in
// tandem with Consumer agents on the other side.
function Worker(vfs) {
    Agent.call(this, {
        // And stream endpoints for writable streams to receive their data
        write: write,
        end: end,
        destroy: destroy,
        kill: kill,
        close: close,
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
        watch: route("watch"),
    });

    var streams = {};
    var watchers = {};
    var processes = {};
    var self = this;
    var remote = this.remoteApi;

    var nextID = 1;
    function getID() {
        while (streams.hasOwnProperty(nextID)) { nextID++; }
        return nextID;
    }

    function storeStream(stream) {
        var id = getID();
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

    function storeWatcher(watcher) {
        var id = getID();
        watchers[id] = watcher;
        watcher.id = id;
        watcher.on("change", function (event, filename) {
            remote.onChange(id, event, filename);
        });
        var token = {id: id};
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

    // Can be used for keepalive checks.
    function ping(callback) {
        callback();
    }

    function route(name) {
        var fn = vfs[name];
        return function wrapped(path, options, callback) {
            // Call the real local function, but intercept the callback
            fn(path, options, function (err, meta) {
                // Make error objects serializable
                if (err) {
                    var nerr = {
                        stack: process.pid + ": " + err.stack
                    }
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
                // Call the remote callback with the result
                callback(null, meta);
            });
        }
    }
}
inherits(Worker, Agent);
