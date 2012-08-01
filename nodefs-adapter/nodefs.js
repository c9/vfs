
const PATH = require("path");
const Stream = require("stream").Stream;

module.exports = function(vfs, base) {

    var resolvePath = base 
        ? function(path) { 
	        if (path.substring(0, base.length) === base) {
	            return path;
	        }
			return PATH.join(base, path);
		}
        : function(path) { return path; };

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

        var stream = options.stream = new Stream();

        vfs.mkfile(resolvePath(path), options, function(err, meta) {
            if (err)
                return callback(err);
        });

        stream.emit("data", data);
        stream.emit("end");
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

    function stat(path, callback) {
        vfs.stat(resolvePath(path), {}, callback);
    }

    function rename(from, to, callback) {
        vfs.rename(resolvePath(to), {from: resolvePath(from)}, callback);
    }

    function mkdirP(path, mode, callback) {
        if (!callback) {
            callback = mode;
            mode = null;
        }
        vfs.exec("mkdir", {args: ["-p", resolvePath(path)]}, callback);
    }

    function mkdir(path, callback) {
        vfs.exec("mkdir", {args: [resolvePath(path)]}, callback);
    }

    function rmfile(path, callback) {
        vfs.rmfile(resolvePath(path), {}, callback || function(){}); // shouldn't vfs handle callback == null?
    }

    function rmdir(path, options, callback) {
        vfs.rmdir(resolvePath(path), options, callback || function(){});
    }

    return {
        readFile: readFile,
        writeFile: writeFile,
        readdir: readdir,
        exists: exists,
        stat: stat,
        rename: rename,
        mkdirP: mkdirP,
        mkdir: mkdir,
        unlink: rmfile,
        rmfile: rmfile,
        rmdir: rmdir,
        vfs: vfs
    }
}
