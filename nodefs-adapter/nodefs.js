
const PATH = require("path");

module.exports = function(vfs, base) {

    function resolvePath(path) {
        if (typeof base === "undefined") {
            return path;
        }
        return PATH.join(base, path);
    }

    function readFile(path, encoding, callback) {
        if (!callback) {
            callback = encoding;
            encoding = null;
        }

        var options = {};
        if (encoding)
            options.encoding = encoding;

        vfs.readfile(resolvePath(path), options, function(err, meta) {
            if (err)
                return callback(err);

            var data = "";
            meta.stream.on("data", function(d) {
                data += d;
            })

            var done;
            meta.stream.on("error", function(e) {
                if (done) return;
                done = true;
                callback(e);
            });

            meta.stream.on("end", function() {
                if (done) return;
                done = true;
                callback(null, data);
            });
        });
    }

    function writeFile(path, data, encoding, callback) {
        if (!callback) {
            callback = encoding;
            encoding = null;
        }

        var options = {};
        if (encoding)
            options.encoding = encoding;

        vfs.mkfile(resolvePath(path), options, function(err, meta) {
            if (err)
                return callback(err);

            var stream = meta.stream;
            stream.write(data);
            stream.end();

            var called;
            stream.on("error", function(err) {
                if (called) return;
                called = true;
                callback(err);
            });

            stream.on("close", function() {
                if (called) return;
                called = true;
                callback();
            });
        });
    }

    function readdir(path, callback) {
        vfs.readdir(resolvePath(path), {encoding: null}, function(err, meta) {
            if (err)
                return callback(err);

            var stream = meta.stream;
            var files = [];

            stream.on("data", function(stat) {
                files.push(stat.name);
            });

            var called;
            stream.on("error", function(err) {
                if (called) return;
                called = true;
                callback(err);
            });

            stream.on("end", function() {
                if (called) return;
                called = true;
                callback(null, files);
            });
        });
    }

    function exists(path, callback) {
        vfs.stat(resolvePath(path), {}, function(err, stat) {
            return callback(stat && !stat.err);
        });
    }

    function rename(from, to, callback) {
        vfs.rename(resolvePath(to), {from: resolvePath(from)}, callback);
    }

    function mkdirP(path, callback) {
        vfs.exec("mkdir", {args: ["-p", resolvePath(path)]}, callback);
    }

    return {
        readFile: readFile,
        writeFile: writeFile,
        readdir: readdir,
        exists: exists,
        rename: rename,
        mkdirP: mkdirP,
        vfs: vfs
    }
}
