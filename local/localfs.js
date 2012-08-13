var fs = require('fs');
var net = require('net');
var childProcess = require('child_process');
var constants = require('constants');
var join = require('path').join;
var pathResolve = require('path').resolve;
var dirname = require('path').dirname;
var basename = require('path').basename;
var Stream = require('stream').Stream;
var getMime = require('simple-mime')("application/octet-stream");
var vm = require('vm');

// Consume all data in a readable stream and call callback with full buffer.
function consumeStream(stream, callback) {
    var chunks = [];
    stream.on("data", onData);
    stream.on("end", onEnd);
    stream.on("error", onError);
    function onData(chunk) {
        chunks.push(chunk);
    }
    function onEnd() {
        cleanup();
        callback(null, chunks.join(""));
    }
    function onError(err) {
        cleanup();
        callback(err);
    }
    function cleanup() {
        stream.removeListener("data", onData);
        stream.removeListener("end", onEnd);
        stream.removeListener("error", onError);
    }
}

// node-style eval
function evaluate(code) {
    var exports = {};
    var module = { exports: exports };
    vm.runInNewContext(code, {
        require: require,
        exports: exports,
        module: module,
        console: console,
        global: global,
        process: process,
        Buffer: Buffer,
        setTimeout: setTimeout,
        clearTimeout: clearTimeout,
        setInterval: setInterval,
        clearInterval: clearInterval
    }, "dynamic-" + Date.now().toString(36), true);
    return module.exports;
}

// Calculate a proper etag from a nodefs stat object
function calcEtag(stat) {
  return (stat.isFile() ? '': 'W/') + '"' + (stat.ino || 0).toString(36) + "-" + stat.size.toString(36) + "-" + stat.mtime.valueOf().toString(36) + '"';
}

// @fsOptions can have:
//   fsOptions.umask - default umask for creating files (defaults to 0750)
//   fsOptions.defaultEnv - a shallow hash of env values to inject into child processes.
//   fsOptions.root - root path to mount, this needs to be realpath'ed or it won't work.
//   fsOptions.checkSymlinks - resolve symlinks before checking if a path is within the root. (defaults to false)
module.exports = function setup(fsOptions) {

    // Check and configure options
    var root = fsOptions.root;
    if (!root) throw new Error("root is a required option");
    if (root[0] !== "/") throw new Error("root path must start in /");
    if (root[root.length - 1] !== "/") root += "/";
    var base = root.substr(0, root.length - 1);
    var umask = fsOptions.umask || 0750;
    if (fsOptions.hasOwnProperty('defaultEnv')) {
        fsOptions.defaultEnv.__proto__ = process.env;
    } else {
        fsOptions.defaultEnv = process.env;
    }

    // Storage for extension APIs
    var apis = {};
    // Storage for event handlers
    var handlers = {};

    // Export the API
    var vfs = {
        // File management
        resolve: resolve,
        stat: stat,
        readfile: readfile,
        readdir: readdir,
        mkfile: mkfile,
        mkdir: mkdir,
        rmfile: rmfile,
        rmdir: rmdir,
        rename: rename,
        copy: copy,
        symlink: symlink,

        // Wrapper around fs.watch or fs.watchFile
        watch: watch,

        // Network connection
        connect: connect,

        // Process Management
        spawn: spawn,
        exec: exec,

        // Basic async event emitter style API
        on: on,
        off: off,
        emit: emit,

        // Extending the API
        extend: extend
    };
    return vfs;

////////////////////////////////////////////////////////////////////////////////

    // Realpath a file and check for access
    // callback(err, path)
    function resolvePath(path, callback, alreadyRooted) {
        if (!alreadyRooted) path = join(root, path);
        if (fsOptions.checkSymlinks) fs.realpath(path, check);
        else check(null, path);

        function check(err, path) {
            if (err) return callback(err);
            if (!(path === base || path.substr(0, root.length) === root)) {
                err = new Error("EACCESS: '" + path + "' not in '" + root + "'");
                err.code = "EACCESS";
                return callback(err);
            }
            callback(null, path);
        }
    }

    // A wrapper around fs.open that enforces permissions and gives extra data in
    // the callback. (err, path, fd, stat)
    function open(path, flags, mode, callback) {
        resolvePath(path, function (err, path) {
            if (err) return callback(err);
            fs.open(path, flags, mode, function (err, fd) {
                if (err) return callback(err);
                fs.fstat(fd, function (err, stat) {
                    if (err) return callback(err);
                    callback(null, path, fd, stat);
                });
            });
        });
    }

    // This helper function doesn't follow node conventions in the callback,
    // there is no err, only entry.
    function createStatEntry(file, fullpath, callback) {
        fs.lstat(fullpath, function (err, stat) {
            var entry = {
                name: file
            };

            if (err) {
                entry.err = err;
                return callback(entry);
            } else {
                entry.access = stat.access;
                entry.size = stat.size;
                entry.mtime = stat.mtime.valueOf();

                if (stat.isDirectory()) {
                    entry.mime = "inode/directory";
                } else if (stat.isBlockDevice()) entry.mime = "inode/blockdevice";
                else if (stat.isCharacterDevice()) entry.mime = "inode/chardevice";
                else if (stat.isSymbolicLink()) entry.mime = "inode/symlink";
                else if (stat.isFIFO()) entry.mime = "inode/fifo";
                else if (stat.isSocket()) entry.mime = "inode/socket";
                else {
                    entry.mime = getMime(fullpath);
                }

                if (!stat.isSymbolicLink()) {
                    return callback(entry);
                }
                fs.readlink(fullpath, function (err, link) {
                    if (err) {
                        entry.linkErr = err.stack;
                        return callback(entry);
                    }
                    entry.link = link;
                    resolvePath(pathResolve(dirname(fullpath), link), function (err, newpath) {
                      if (err) {
                          entry.linkStatErr = err;
                          return callback(entry);
                      }
                      createStatEntry(basename(newpath), newpath, function (linkStat) {
                          entry.linkStat = linkStat;
                          linkStat.fullPath = newpath.substr(base.length) || "/";
                          return callback(entry);
                      });
                    }, true/*alreadyRooted*/);
                });
            }
        });
    }

    // Common logic used by rmdir and rmfile
    function remove(path, fn, callback) {
        var meta = {};
        resolvePath(path, function (err, path) {
            if (err) return callback(err);
            fn(path, function (err) {
                if (err) return callback(err);
                return callback(null, meta);
            });
        });
    }

////////////////////////////////////////////////////////////////////////////////

    function resolve(path, options, callback) {
        resolvePath(path, function (err, path) {
            if (err) return callback(err);
            callback(null, { path: path });
        }, options.alreadyRooted);
    }

    function stat(path, options, callback) {

        // Make sure the parent directory is accessable
        resolvePath(dirname(path), function (err, dir) {
            if (err) return callback(err);
            var file = basename(path);
            path = join(dir, file);
            createStatEntry(file, path, function (entry) {
                if (entry.err) {
                    return callback(entry.err);
                }
                callback(null, entry);
            });
        });
    }

    function readfile(path, options, callback) {

        var meta = {};

        open(path, "r", umask & 0666, function (err, path, fd, stat) {
            if (err) return callback(err);
            if (stat.isDirectory()) {
                fs.close(fd);
                var err = new Error("EISDIR: Requested resource is a directory");
                err.code = "EISDIR";
                return callback(err);
            }

            // Basic file info
            meta.mime = getMime(path);
            meta.size = stat.size;
            meta.etag = calcEtag(stat);

            // ETag support
            if (options.etag === meta.etag) {
                meta.notModified = true;
                fs.close(fd);
                return callback(null, meta);
            }

            // Range support
            if (options.hasOwnProperty('range') && !(options.range.etag && options.range.etag !== meta.etag)) {
                var range = options.range;
                var start, end;
                if (range.hasOwnProperty("start")) {
                    start = range.start;
                    end = range.hasOwnProperty("end") ? range.end : meta.size - 1;
                }
                else {
                    if (range.hasOwnProperty("end")) {
                        start = meta.size - range.end;
                        end = meta.size - 1;
                    }
                    else {
                        meta.rangeNotSatisfiable = "Invalid Range";
                        fs.close(fd);
                        return callback(null, meta);
                    }
                }
                if (end < start || start < 0 || end >= stat.size) {
                    meta.rangeNotSatisfiable = "Range out of bounds";
                    fs.close(fd);
                    return callback(null, meta);
                }
                options.start = start;
                options.end = end;
                meta.size = end - start + 1;
                meta.partialContent = { start: start, end: end, size: stat.size };
            }

            // HEAD request support
            if (options.hasOwnProperty("head")) {
                fs.close(fd);
                return callback(null, meta);
            }

            // Read the file as a stream
            try {
                options.fd = fd;
                meta.stream = new fs.ReadStream(path, options);
            } catch (err) {
                fs.close(fd);
                return callback(err);
            }
            callback(null, meta);
        });
    }

    function readdir(path, options, callback) {

        var meta = {};

        resolvePath(path, function (err, path) {
            if (err) return callback(err);
            fs.stat(path, function (err, stat) {
                if (err) return callback(err);
                if (!stat.isDirectory()) {
                    err = new Error("ENOTDIR: Requested resource is not a directory");
                    err.code = "ENOTDIR";
                    return callback(err);
                }

                // ETag support
                meta.etag = calcEtag(stat);
                if (options.etag === meta.etag) {
                    meta.notModified = true;
                    return callback(null, meta);
                }

                fs.readdir(path, function (err, files) {
                    if (err) return callback(err);
                    if (options.head) {
                        return callback(null, meta);
                    }
                    var stream = new Stream();
                    stream.readable = true;
                    var paused;
                    stream.pause = function () {
                        if (paused === true) return;
                        paused = true;
                    };
                    stream.resume = function () {
                        if (paused === false) return;
                        paused = false;
                        getNext();
                    };
                    meta.stream = stream;
                    callback(null, meta);
                    var index = 0;
                    stream.resume();
                    function getNext() {
                        if (index === files.length) return done();
                        var file = files[index++];
                        var fullpath = join(path, file);

                        createStatEntry(file, fullpath, function onStatEntry(entry) {
                            stream.emit("data", entry);

                            if (!paused) {
                                getNext();
                            }
                        });
                    }
                    function done() {
                        stream.emit("end");
                    }
                });
            });
        });
    }

    function mkfile(path, options, realCallback) {
        var meta = {};
        var called;
        var callback = function (err, meta) {
            if (called) {
                if (err) {
                    if (meta.stream) meta.stream.emit("error", err);
                    else console.error(err.stack);
                }
                else if (meta.stream) meta.stream.emit("saved");
                return;
            }
            called = true;
            return realCallback.apply(this, arguments);
        };

        if (options.stream && !options.stream.readable) {
            return callback(new TypeError("options.stream must be readable."));
        }

        // Pause the input for now since we're not ready to write quite yet
        var readable = options.stream;
        if (readable) {
            if (readable.pause) readable.pause();
            var buffer = [];
            readable.on("data", onData);
            readable.on("end", onEnd);
        }

        function onData(chunk) {
            buffer.push(["data", chunk]);
        }
        function onEnd() {
            buffer.push(["end"]);
        }
        function error(err) {
            if (readable) {
                readable.removeListener("data", onData);
                readable.removeListener("end", onEnd);
                if (readable.destroy) readable.destroy();
            }
            if (err) callback(err);
        }

        // Make sure the user has access to the directory and get the real path.
        resolvePath(path, function (err, resolvedPath) {
            if (err) {
                if (err.code !== "ENOENT") {
                    return error(err);
                }
                // If checkSymlinks is on we'll get an ENOENT when creating a new file.
                // In that case, just resolve the parent path and go from there.
                resolvePath(dirname(path), function (err, dir) {
                    if (err) return error(err);
                    onPath(join(dir, basename(path)));
                });
                return;
            }
            onPath(resolvedPath);
        });

        function onPath(path) {
            if (!options.mode) options.mode = umask & 0666;
            var writable = new fs.WriteStream(path, options);
            if (readable) {
                readable.pipe(writable);
            }
            else {
                meta.stream = writable;
                callback(null, meta);
            }
            var hadError;
            writable.once('error', function (err) {
                hadError = true;
                error(err);
            });
            writable.on('close', function () {
                if (hadError) return;
                callback(null, meta);
            });

            if (readable) {
                // Stop buffering events and playback anything that happened.
                readable.removeListener("data", onData);
                readable.removeListener("end", onEnd);
                buffer.forEach(function (event) {
                    readable.emit.apply(readable, event);
                });
                // Resume the input stream if possible
                if (readable.resume) readable.resume();
            }
        }
    }

    function mkdir(path, options, callback) {
        var meta = {};
        // Make sure the user has access to the parent directory and get the real path.
        resolvePath(dirname(path), function (err, dir) {
            if (err) return callback(err);
            path = join(dir, basename(path));
            fs.mkdir(path, function (err) {
                if (err) return callback(err);
                callback(null, meta);
            });
        });
    }

    function rmfile(path, options, callback) {
        remove(path, fs.unlink, callback);
    }

    function rmdir(path, options, callback) {
        if (options.recursive) {
            remove(path, function(path, callback) {
                exec("rm", {args: ["-rf", path]}, callback);
            }, callback);
        }
        else {
            remove(path, fs.rmdir, callback);
        }
    }

    function rename(path, options, callback) {
        var from, to;
        if (options.from) {
            from = options.from; to = path;
        }
        else if (options.to) {
            from = path; to = options.to;
        }
        else {
            return callback(new Error("Must specify either options.from or options.to"));
        }
        var meta = {};
        // Get real path to source
        resolvePath(from, function (err, from) {
            if (err) return callback(err);
            // Get real path to target dir
            resolvePath(dirname(to), function (err, dir) {
                if (err) return callback(err);
                to = join(dir, basename(to));
                // Rename the file
                fs.rename(from, to, function (err) {
                    if (err) return callback(err);
                    callback(null, meta);
                });
            });
        });
    }

    function copy(path, options, callback) {
        var from, to;
        if (options.from) {
            from = options.from; to = path;
        }
        else if (options.to) {
            from = path; to = options.to;
        }
        else {
            return callback(new Error("Must specify either options.from or options.to"));
        }
        readfile(from, {}, function (err, meta) {
            if (err) return callback(err);
            mkfile(to, {stream: meta.stream}, callback);
        });
    }

    function symlink(path, options, callback) {
        if (!options.target) return callback(new Error("options.target is required"));
        var meta = {};
        // Get real path to target dir
        resolvePath(dirname(path), function (err, dir) {
            if (err) return callback(err);
            path = join(dir, basename(path));
            fs.symlink(options.target, path, function (err) {
                if (err) return callback(err);
                callback(null, meta);
            });
        });
    }


    function on(name, handler, callback) {
        if (!handlers[name]) handlers[name] = [];
        handlers[name].push(handler);
        callback && callback();
    }

    function off(name, handler, callback) {
        var list = handlers[name];
        if (list) {
            var index = list.indexOf(handler);
            if (index >= 0) {
                list.splice(index, 1);
            }
        }
        callback && callback();
    }

    function emit(name, value, callback) {
        var list = handlers[name];
        if (list) {
            for (var i = 0, l = list.length; i < l; i++) {
                list[i](value);
            }
        }
        callback && callback();
    }

    function spawn(executablePath, options, callback) {

      var args = options.args || [];

      if (options.hasOwnProperty('env')) {
        options.env.__proto__ = fsOptions.defaultEnv;
      } else {
        options.env = fsOptions.defaultEnv;
      }

      var child;
      try {
        child = childProcess.spawn(executablePath, args, options);
      } catch (err) {
        return callback(err);
      }
      if (options.resumeStdin) child.stdin.resume();
      if (options.hasOwnProperty('stdoutEncoding')) {
        child.stdout.setEncoding(options.stdoutEncoding);
      }
      if (options.hasOwnProperty('stderrEncoding')) {
        child.stderr.setEncoding(options.stderrEncoding);
      }

      child.kill = function(signal) {
        killtree(child, signal);
      };

      callback(null, {
        process: child
      });
    }

    function exec(executablePath, options, callback) {
      spawn(executablePath, options, function(err, meta) {
        if (err) return callback(err);

        var stdout = [];
        var stderr = [];

        meta.process.stdout.on("data", function(data) { stdout.push(data); });
        meta.process.stderr.on("data", function(data) { stderr.push(data); });

        meta.process.on("exit", function(code, signal) {
          var err = null;
          stdout = stdout.join("").trim();
          stderr = stderr.join("").trim();

          if (code || signal) {
            err = new Error("process died");
            if (signal) {
              err.message += " because of signal " + signal;
              err.signal = signal;
            }
            if (code) {
              err.message += " with exit code " + code;
              err.exitCode = code;
            }
            if (stdout) {
              err.message += "\n" + stdout;
              err.stdout = stdout;
            }
            if (stderr) {
              err.message += "\n" + stderr;
              err.stderr = stderr;
            }
            return callback(err, stdout, stderr);
          }

          callback(err, stdout, stderr);
        });
      });
    }

    function extend(name, options, callback) {

      var meta = {};
      // Pull from cache if it's already loaded.
      if (!options.skipCache && apis.hasOwnProperty(name)) {
        meta.api = apis[name];
        return callback(null, meta);
      }

      var fn;

      // The user can pass in a path to a file to require
      if (options.file) {
        try { fn = require(options.file); }
        catch (err) { return callback(err); }
        fn(vfs, onEvaluate);
      }

      // User can pass in code as a pre-buffered string
      else if (options.code) {
        try { fn = evaluate(options.code); }
        catch (err) { return callback(err); }
        fn(vfs, onEvaluate);
      }

      // Or they can provide a readable stream
      else if (options.stream) {
        var stream = new MemStream();
        options.stream.pipe(stream);
        stream.on("done", function (code) {
          var fn;
          try {
            fn = evaluate(code);
          } catch(err) {
            return callback(err);
          }
          fn(vfs, onEvaluate);
        });
      }

      else {
        return callback(new Error("must provide `file`, `code`, or `stream` when cache is empty for " + name));
      }

      function onEvaluate(err, exports) {
        if (err) {
          return callback(err);
        }
        exports.names = Object.keys(exports);
        exports.name = name;
        apis[name] = exports;
        meta.api = exports;
        callback(null, meta);
      }

    }

    function connect(port, options, callback) {

      var retries = options.hasOwnProperty('retries') ? options.retries : 5;
      var retryDelay = options.hasOwnProperty('retryDelay') ? options.retryDelay : 50;
      tryConnect();
      function tryConnect() {
        var socket = net.connect(port, function () {
          if (options.hasOwnProperty('encoding')) {
            socket.setEncoding(options.encoding);
          }
          callback(null, {stream:socket});
        });
        socket.once("error", function (err) {
          if (err.code === "ECONNREFUSED" && retries) {
            setTimeout(tryConnect, retryDelay);
            retries--;
            retryDelay *= 2;
            return;
          }
          return callback(err);
        });
      }
    }

    // Simple wrapper around node's fs.watch function.  Returns a watcher object
    // that emits "change" events.  Make sure to call .close() when done to
    // prevent leaks.
    function watch(path, options, callback) {

      var meta = {};
      realpath(path, function (err, path) {
        if (err) return callback(err);
        if (options.file) {
          meta.watcher = fs.watchFile(path, options, function () {});
          meta.watcher.close = function () {
            fs.unwatchFile(path);
          };
        }
        else {
          meta.watcher = fs.watch(path, options, function () {});
        }
        callback(null, meta);
      });
    }

};

