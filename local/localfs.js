var fs = require('fs');
var net = require('net');
var childProcess = require('child_process');
var constants = require('constants');
var join = require('path').join;
var resolve = require('path').resolve;
var dirname = require('path').dirname;
var basename = require('path').basename;
var Stream = require('stream').Stream;
var getMime = require('simple-mime')("application/octet-stream");

// Functions useful for matching users and permissions
// hopefully the engine inlines these.
function canRead(owner, inGroup, mode) {
  return owner && (mode & 00400) || // User is owner and owner can read.
         inGroup && (mode & 00040) || // User is in group and group can read.
         (mode & 00004); // Anyone can read.
}
function canWrite(owner, inGroup, mode) {
  return owner && (mode & 00200) || // User is owner and owner can write.
         inGroup && (mode & 00020) || // User is in group and group can write.
         (mode & 00002); // Anyone can write.
}
function canExec(owner, inGroup, mode) {
  return owner && (mode & 00100) || // User is owner and owner can exec.
         inGroup && (mode & 00010) || // User is in group and group can exec.
         (mode & 00001); // Anyone can write.
}

function calcEtag(stat) {
  return (stat.isFile() ? '': 'W/') + '"' + stat.ino.toString(36) + "-" + stat.size.toString(36) + "-" + stat.mtime.valueOf().toString(36) + '"';
}

// @fsOptions can have:
//   fsOptions.uid - restricts access as if this user was running as
//   fsOptions.gid   this uid/gid, create files as this user.
//   fsOptions.umask - default umask for creating files
//   fsOptions.root - root path to mount, this needs to be realpath'ed or it won't work.
//   fsOptions.skipSearchCheck - Skip the folder execute/search permission check on file open.
module.exports = function setup(fsOptions) {
  var root = fsOptions.root;
  if (!root) throw new Error("root is a required option");
  if (root[root.length - 1] !== "/") throw new Error("root path must end in /");
  if (root[0] !== "/") throw new Error("root path must start in /");
  var base = root.substr(0, root.length - 1);

  var umask = fsOptions.umask || 0750;
  var checkPermissions, fsUid, fsGid;

  if (fsOptions.hasOwnProperty('defaultEnv')) {
    fsOptions.defaultEnv.__proto__ = process.env;
  } else {
    fsOptions.defaultEnv = process.env;
  }

  if (fsOptions.hasOwnProperty("uid") || fsOptions.hasOwnProperty("gid")) {
    if (typeof fsOptions.uid === "number" || typeof fsOptions.uid === "number") {
      fsUid = fsOptions.uid || process.getuid();
      fsGid = fsOptions.gid || process.getgid();

      // only do the extra checks if the fs uid/gid is different to the logged
      // in user
      if (fsGid !== process.getgid() || fsUid !== process.getuid()) {
        checkPermissions = true; // Tell the system to not assume anything.
      }
    }
  } else {
    if (process.getuid() === 0) throw new Error("Please specify uid or gid when running as root");
    // The process represents itself
    fsUid = process.getuid();
    fsGid = process.getgid();
  }

  return {
    // Process Management
    spawn: spawn,
    exec: exec,

    // Network tunnel
    connect: connect,

    // FS management
    readfile: readfile,
    mkfile: mkfile,
    rmfile: rmfile,
    readdir: readdir,
    stat: stat,
    mkdir: mkdir,
    rmdir: rmdir,
    rename: rename,
    copy: copy,
    symlink: symlink,

    watch: watch,
    changedSince: changedSince,

    // for internal use only
    killtree: killtree
  };

  // Give this a stat object (or any object containing uid, gid, and mode) and
  // it will tell you what permissions the current fs instance has as a number.
  // READ = 4, 2 = WRITE, 1 = EXEC
  function permissions(stat) {
    var owner = fsUid > 0 ? fsUid === stat.uid : true;
    var group = fsGid > 0 ? fsGid === stat.gid : true;
    var mode = stat.mode;
    return (canRead(owner, group, mode) ? 4 : 0) |
          (canWrite(owner, group, mode) ? 2 : 0) |
           (canExec(owner, group, mode) ? 1 : 0);
  }

  // This check is to see if the fs instance has search access for a path.
  // It recursivly checks for the execute/search bit on all parent directories.
  function pathAccess(path, callback) {
    var dir = dirname(path);
    if (!checkPermissions || fsUid === 0 || fsGid === 0 || fsOptions.skipSearchCheck) {
      return callback(null, true);
    }
    fs.stat(dir, function (err, stat) {
      if (err) return callback(err);
      var owner = fsUid > 0 ? fsUid === stat.uid : true;
      var group = fsGid > 0 ? fsGid === stat.gid : true;
      var mode = stat.mode;
      if (!canExec(owner, group, mode)) {
        return callback(null, false);
      }
      if (dir === "/") {
        return callback(null, true);
      }
      pathAccess(dir, callback);
    });
  }

  // Realpath a file and check for access
  // callback(err, path)
  function realpath(path, callback, alreadyRooted) {
    fs.realpath(alreadyRooted ? path : join(root, path), function (err, path) {
      if (err) return callback(err);
      if (!(path === base || path.substr(0, root.length) === root)) {
        err = new Error("EACCESS: '" + path + "' not in '" + root + "'");
        err.code = "EACCESS";
        return callback(err);
      }
      pathAccess(path, function (err, access) {
        if (err) return callback(err);
        if (!access) {
          err = new Error("EACCESS: Access Denied");
          err.code = "EACCESS";
          return callback(err);
        }
        callback(null, path);
      });
    });
  }

  // Helpers to check permissions while getting a stat object.
  function statSafe(path, requestedPermissions, callback) {
    fs.stat(path, function (err, stat) {
      onSafeStat(err, stat, requestedPermissions, callback);
    });
  }
  function lstatSafe(path, requestedPermissions, callback) {
    fs.lstat(path, function (err, stat) {
      onSafeStat(err, stat, requestedPermissions, callback);
    });
  }
  function fstatSafe(fd, requestedPermissions, callback) {
    fs.fstat(fd, function (err, stat) {
      onSafeStat(err, stat, requestedPermissions, callback);
    });
  }
  function onSafeStat(err, stat, requestedPermissions, callback) {
    if (err) return callback(err);
    var access = permissions(stat);
    if ((access & requestedPermissions) !== requestedPermissions) {
      err = new Error("EACCESS: Permission Denied");
      err.code = "EACCESS";
      return callback(err);
    }
    stat.access = access;
    callback(null, stat);
  }

  // A wrapper around fs.open that enforces permissions and gives extra data in
  // the callback. (err, path, fd, stat)
  function open(path, flags, mode, callback) {
    realpath(path, function (err, path) {
      if (err) return callback(err);
      fs.open(path, flags, mode, function (err, fd) {
        if (err) return callback(err);
        var requestedPermissions;
        switch (flags) {
          case "r": requestedPermissions = 4; break;
          case "w": case "a": requestedPermissions = 2; break;
          case "r+": case "w+": case "a+": requestedPermissions = 6; break;
          default: throw new Error("Invalid flag " + flags);
        }
        fstatSafe(fd, requestedPermissions, function (err, stat) {
          if (err) return callback(err);
          callback(null, path, fd, stat);
        });
      });
    });
  }

  function spawn(executablePath, options, callback) {
    var args = options.args || [];
    if (checkPermissions && fsOptions.hasOwnProperty('uid')) {
      options.uid = fsOptions.uid;
    }
    if (checkPermissions && fsOptions.hasOwnProperty('gid')) {
      options.gid = fsOptions.gid;
    }

    if (options.hasOwnProperty('env')) {
      options.env.__proto__ = fsOptions.defaultEnv;
    } else {
      options.env = fsOptions.defaultEnv;
    }

    try {
      var child = childProcess.spawn(executablePath, args, options);
    } catch (e) {
      return callback(e);
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

  function killtree(child, signal){
    signal = signal || "SIGTERM";
    var pid = child.pid;

    childrenOfPid(pid, function(err, pidlist){
      if (err) {
        console.error(err);
        return;
      }

      pidlist.forEach(function (pid) {
        try {
          process.kill(pid, signal);
        } catch(e) {
          // kill may throw if the pid does not exist.
        }
      });
    });
  }

  function childrenOfPid(pid, callback) {
    exec("ps", {args: ["-A", "-oppid,pid"]}, function(err, stdout, stderr) {
      if (err)
        return callback(err);

      var parents = {};
      stdout.split("\n").slice(1).forEach(function(line) {
        var col = line.trim().split(/\s+/g);
        (parents[col[0]] || (parents[col[0]] = [])).push(col[1]);
      });

      function search(roots) {
        var res = roots.concat();
        for (var c, i = 0; i < roots.length; i++) {
          if ((c = parents[roots[i]]) && c.length)
            res.push.apply(res, search(c));
        }
        return res;
      }
      callback(null, search([pid]));
    });
  }

  function connect(port, options, callback) {
    if (typeof port !== "number") throw new Error("port must be a number");
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

  // Like fs.createReadStream, except with added HTTP-like options.
  // Doesn't return a stream immedietly, but as a "stream" option in the meta
  // object in the callback.
  //
  // @options is passed through to fs.ReadStream, but also can have:
  //   options.etag - the browser sent an If-None-Match header with etag
  //   options.head - the request was a HEAD request
  //   options.range - the request had a Range header, this object can have
  //                   "start", "end" and/or "etag"
  // @path is relative to the fsOptions.root setting in this vfs instance
  // @callback is `function (err, meta) {...}`
  //   err is truthy if there is a server error and the browser should send 500,
  //       403, or 404 depending on err.code.
  //   meta in the callback has:
  //     meta.notModified - truthy if the server should send 304 (etag matched)
  //     meta.rangeNotSatisfiable - truthy if the server should send 416
  //     meta.partialContent - object if server should send 206 and contains
  //          "start", "end", and "size" needed for the "Content-Range" header.
  //     meta.size - the size of the file
  //     meta.etag - the etag of the file (embeds inode, size and mtime)
  //     meta.stream - a readable stream if the response should have a body.
  function readfile(path, options, callback) {
    var meta = {};

    open(path, "r", umask & 0666, function (err, path, fd, stat) {
      if (err) return callback(err);
      if (!stat.isFile()) {
        fs.close(fd);
        return callback(new Error("Requested resource is not a file"));
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
        var start = range.hasOwnProperty("start") ? range.start : 0;
        var end = range.hasOwnProperty("end") ? range.end : stat.size - 1;
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

  // Reads a directory and streams data about the files as json.
  // The order of the files in undefined.  The client should sort afterwards.
  function readdir(path, options, callback) {
    var meta = {};
    var encoding = "json";
    if (options.hasOwnProperty("encoding")) encoding = options.encoding;
    if (!(!encoding || encoding === "json")) {
      return callback(new Error("encoding must be null or 'json'"));
    }

    realpath(path, function (err, path) {
      if (err) return callback(err);
      statSafe(path, 4/*READ*/, function (err, stat) {
        if (err) return callback(err);
        if (!stat.isDirectory()) {
          return callback(new Error("Requested resource is not a directory"));
        }

        // ETag support
        meta.etag = calcEtag(stat);
        if (options.etag === meta.etag) {
          meta.notModified = true;
          return callback(null, meta);
        }

        fs.readdir(path, function (err, files) {
          if (err) return callback(err);
          if (encoding === "json") meta.mime = "application/json";
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
          if (encoding === "json") stream.emit("data", "[");
          var index = 0;
          stream.resume();
          function getNext() {
            if (index === files.length) return done();
            var file = files[index++];
            var left = files.length - index;
            var fullpath = join(path, file);

            if (stat.access & 1/*EXEC/SEARCH*/) { // Can they enter the directory?
              createStatEntry(file, fullpath, onStatEntry);
            }
            else {
              var err = new Error("EACCESS: Permission Denied");
              err.code = "EACCESS";
              onStatEntry({
                name: file,
                err: err
              });
            }
            function onStatEntry(entry) {
              if (encoding === "json")
                stream.emit("data", "\n  " + JSON.stringify(entry) + (left ? ",":""));
              else
                stream.emit("data", entry);

              if (!paused) {
                getNext();
              }
            }
          }
          function done() {
            if (encoding === "json") stream.emit("data", "\n]\n");
            stream.emit("end");
          }
        });
      });
    });
  }

  function stat(path, options, callback) {
    // Make sure the parent directory is accessable
    realpath(dirname(path), function (err, dir) {
      if (err) return callback(err);
      // Make sure they can enter the parent directory too
      statSafe(dir, 1/*EXEC/SEARCH*/, function (err) {
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
    });
  }

  // This helper function doesn't follow node conventions in the callback,
  // there is no err, only entry.
  function createStatEntry(file, fullpath, callback) {
    lstatSafe(fullpath, 0, function (err, stat) {
      var entry = {
        name: file
      };

      if (err) {
        entry.err = err.stack || err;
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
          realpath(resolve(dirname(fullpath), link), function (err, newpath) {
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

  // This is used for creating / overwriting files.  It always creates a new tmp
  // file and then renamed to the final destination.
  function mkfile(path, options, callback) {
    var meta = {};

    // Make sure the user has access to the directory and get the real path.
    realpath(dirname(path), function (err, dir) {
      if (err) return callback(err);
      path = join(dir, basename(path));
      // Use a temp file for both atomic saves and to ensure we never write to
      // existing files.  Writing to an existing symlink would bypass the
      // security restrictions.
      var tmpPath = path + "." + (Date.now() + Math.random() * 0x100000000).toString(36) + ".tmp";
      // node 0.8.x adds a "wx" shortcut, but since it's not in 0.6.x we use the
      // longhand here.
      var flags = constants.O_CREAT | constants.O_WRONLY | constants.O_EXCL;
      fs.open(tmpPath, flags, umask & 0666, function (err, fd) {
        if (err) return callback(err);
        options.fd = fd;
        if (checkPermissions) {
          // Set the new file to the specified user
          fs.fchown(fd, fsUid, fsGid, function (err) {
            if (err) {
              fs.close(fd);
              return callback(err);
            }
            onCreate();
          });
        } else {
          onCreate();
        }
        function onCreate() {
          var stream = new fs.WriteStream(path, options);
          var hadError;
          stream.once('error', function () {
            hadError = true;
          });
          stream.on('close', function () {
            if (hadError) return;
            fs.rename(tmpPath, path, function (err) {
              if (err) return stream.emit("error", err);
              stream.emit("saved");
            });
          });
          meta.stream = stream;
          meta.tmpPath = tmpPath;
          callback(null, meta);
        }
      });
    });
  }

  function mkdir(path, options, callback) {
    var meta = {};
    // Make sure the user has access to the parent directory and get the real path.
    realpath(dirname(path), function (err, dir) {
      if (err) return callback(err);
      path = join(dir, basename(path));
      fs.mkdir(path, function (err) {
        if (err) return callback(err);
        if (checkPermissions) {
          // Set the new file to the specified user
          fs.chown(path, fsUid, fsGid, function (err) {
            if (err) return callback(err);
            callback(null, meta);
          });
        } else {
          callback(null, meta);
        }
      });
    });
  }

  // Common logic used by rmdir and rmfile
  function remove(path, fn, callback) {
    var meta = {};
    realpath(path, function (err, path) {
      if (err) return callback(err);
      // Make sure the user can modify the directory contents
      statSafe(dirname(path), 2/*WRITE*/, function (err) {
        if (err) return callback(err);
        fn(path, function (err) {
          if (err) return callback(err);
          return callback(null, meta);
        });
      });
    });
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

  function rmfile(path, options, callback) {
    remove(path, fs.unlink, callback);
  }

  function rename(path, options, callback) {
    var meta = {};
    // Get real path to target dir
    realpath(dirname(path), function (err, dir) {
      if (err) return callback(err);
      // Make sure the user can modify the target directory
      statSafe(dir, 2/*WRITE*/, function (err) {
        if (err) return callback(err);
        // Make sure the source file is accessable
        realpath(options.from, function (err, from) {
          if (err) return callback(err);
          // Make sure the user can modify the source directory
          statSafe(dirname(from), 2/*WRITE*/, function (err) {
            if (err) return callback(err);
            // Rename the file
            fs.rename(from, join(dir, basename(path)), function (err) {
              if (err) return callback(err);
              callback(null, meta);
            });
          });
        });
      });
    });
  }

  // Copy is just piping a readstream to a writestream, so let's reuse the
  // existing functions.
  function copy(path, options, callback) {
    var meta = {};
    mkfile(path, {}, function (err, writeMeta) {
      if (err) return callback(err);
      readfile(options.from, {}, function (err, readMeta) {
        if (err) return callback(err);
        readMeta.stream.pipe(writeMeta.stream);
        writeMeta.stream.on("error", callback);
        writeMeta.stream.on("saved", function () {
          callback(null, meta);
        });
      });
    });
  }

  function symlink(path, options, callback) {
    var meta = {};
    // Get real path to target dir
    realpath(dirname(path), function (err, dir) {
      if (err) return callback(err);
      // Make sure the user can modify the target directory
      statSafe(dir, 2, function (err) {
        if (err) return callback(err);
        fs.symlink(options.target, join(dir, basename(path)), function (err) {
          if (err) return callback(err);
          callback(null, meta);
        });
      });
    });
  }

  // Simple wrapper around node's fs.watch function.  Returns a watcher object
  // that emits "change" events.  Make sure to call .close() when done to
  // prevent leaks.
  function watch(path, options, callback) {
    var meta = {};
    realpath(path, function (err, path) {
      if (err) return callback(err);
      meta.watcher = fs.watch(path, options, function (event, filename) {});
      callback(null, meta);
    });
  }

  function changedSince(paths, options, callback) {
    if (!options.since) {
      return callback(new Error("since is a required option"));
    }
    if (!Array.isArray(paths)) {
      return callback(new Error("paths must be an array"));
    }
    var since = (new Date(options.since)).getTime();
    var length = paths.length;
    var meta = {};
    var changed = meta.changed = [];
    var errors = {};
    var offset = 0;
    (function next() {
      if (offset === length) done();
      var filePath = paths[offset];
      realpath(filePath, function (err, path) {
        if (err) {
          errors[filePath] = err;
          return next();
        }
        fs.stat(path, function (err, stat) {
          if (err) {
            errors[filePath] = err;
            return next();
          }
          var mtime = stat.mtime.getTime();
          if (mtime > since) {
            changed.push(filePath);
          }
          next();
        });
      });
      offset++;
    }());
    function done() {
      if (Object.keys(errors).length) {
        meta.errors = errors;
      }
      callback(null, meta);
    }
  }

};

