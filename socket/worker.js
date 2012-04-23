var Stream = require('stream').Stream;
var socketTransport = require('architect-socket-transport');
var Agent = require('architect-agent').Agent;
var vfsLocal = require('vfs-local');

// @fsOptions can have:
//   all fs options from vfs-local
//   and also:
//   fsOptions.input - input stream
//   fsOptions.output - output stream (reuses input if not given)
//   fsOptions.callback - get's called with the remote once connected
module.exports = function setup(fsOptions) {
    var input = fsOptions.input;
    if (!(input instanceof Stream && input.readable !== false)) throw new TypeError("input must be a readable Stream");
    var output = fsOptions.hasOwnProperty("output") ? fsOptions.output : input;
    if (!(output instanceof Stream && output.writable !== false)) throw new TypeError("output must be a writable Stream");

    var streams = {};
    var remote;

    var nextID = 1;
    function getID() {
        while (streams.hasOwnProperty(nextID)) { nextID++; }
        return nextID;
    }

    function storeStream(stream) {
        var id = getID();
        streams[id] = stream;
        if (stream.readable) {
            stream.on("data", function (chunk) {
                remote.onData(id, chunk);
            });
            stream.on("end", function () {
                remote.onEnd(id);
                delete streams[id];
                nextID = id;
            });
        }
        var token = {id: id};
        if (stream.hasOwnProperty("readable")) token.readable = stream.readable;
        if (stream.hasOwnProperty("writable")) token.writable = stream.writable;
        return token;
    }

    // Remote side writing to our local writable streams
    function write(id, chunk) {
        // They want to write to our real stream
        var stream = streams[id];
        stream.write(chunk);
    }
    function end(id, chunk) {
        var stream = streams[id];
        stream.end(chunk);
        delete streams[id];
        nextID = id;
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
                    console.log("nerr", nerr);
                    return callback(nerr);
                }
                // Replace streams with tokens
                if (meta.stream) {
                    meta.stream = storeStream(meta.stream);
                }
                // Call the remote callback with the result
                callback(null, meta);
            });
        }
    }

    // Get the local vfs and wrap it so we can fix streams
    var vfs = vfsLocal(fsOptions);

    var agent = new Agent({
        // And stream endpoints for writable streams to receive their data
        write: write,
        end: end,
        // Route other calls to the local vfs instance
        readfile: route("readfile"),
        mkfile: route("mkfile"),
        rmfile: route("rmfile"),
        readdir: route("readdir"),
        mkdir: route("mkdir"),
        rmdir: route("rmdir"),
        rename: route("rename"),
        copy: route("copy"),
        symlink: route("symlink")
    });

    agent.attach(socketTransport(input, output), function (consumer) {
        remote = consumer;
        if (fsOptions.callback) fsOptions.callback(consumer);
    });

    // Pass through the original local vfs in case it's wanted.
    return vfs;
};
