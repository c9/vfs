var fs = require('fs');
var constants = require('constants');
var join = require('path').join;
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
//   fsOptions.httpRoot - used for generating links in directory listing.  It's where this fs is mounted over http.
module.exports = function setup(fsOptions) {
  var root = fsOptions.root || "/";
  if (root[root.length - 1] !== "/") root += "/";
  var base = root.substr(0, root.length - 1);

  var umask = fsOptions.umask || 0750;
  var checkPermissions, fsUid, fsGid;
  if (fsOptions.hasOwnProperty("uid") || fsOptions.hasOwnProperty("gid")) {
    // The process is running as root, but wants to simulate another user.
    if (process.getuid() > 0) {
      throw new Error("uid and/or gid specified, but not running as root");
    }
    checkPermissions = true; // Tell the system to not assume anything.
    fsUid = fsOptions.uid || process.getuid();
    fsGid = fsOptions.gid || process.getgid();
  } else {
    // The process represents itself
    fsUid = process.getuid();
    fsGid = process.getgid();
  }

  return {
    readfile: readfile,
    mkfile: mkfile,
    rmfile: rmfile,
    readdir: readdir,
    mkdir: mkdir,
    rmdir: rmdir,
    rename: rename,
    copy: copy,
    symlink: symlink
  };

  // Give this a stat object (or any object containing uid, gid, and mode) and
  // it will tell you what permissions the current fs instance has as a number.
  // READ = 4, 2 = WRITE, 1 = EXEC
  function permissions(stat) {
    var owner = fsUid > 0 ? fsUid === stat.uid : true;
    var group = fsGid > 0 ? fsGid === stat.gid : true;
    var mode = stat.mode;
    return (canRead(owner, group, mode) ? 4 : 0) +
          (canWrite(owner, group, mode) ? 2 : 0) +
           (canExec(owner, group, mode) ? 1 : 0);
  }

  // This check is to see if the fs instance has search access for a path.
  // It recursivly checks for the execute/search bit on all parent directories.
  function pathAccess(path, callback) {
    var dir = dirname(path);
    if (!checkPermissions || fsUid === 0 || fsUid === 0 || fsOptions.skipSearchCheck) {
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
  function realpath(path, callback) {
    fs.realpath(join(root, path), function (err, path) {
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
  // TODO: we need to throttle the parallel stat calls.  This won't scale to thousands.
  // TODO: Implement tcp backpressure so we don't write faster than the client can receive and be forced to buffer in ram.
  function readdir(path, options, callback) {
    var meta = {};

    realpath(path, function (err, path) {
      if (err) return callback(err);
      statSafe(path, 4, function (err, stat) {
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
          meta.mime = "application/json";
          if (options.head) {
            return callback(null, meta);
          }
          var stream = new Stream();
          stream.readable = true;
          meta.stream = stream;
          callback(null, meta);
          stream.emit("data", "[");
          var left = files.length;
          files.forEach(function (file) {
            var fullpath = join(path, file);
            var filepath = fullpath.substr(base.length);
            if (filepath[0] !== "/") filepath = "/" + filepath;
            lstatSafe(fullpath, 0, function (err, stat) {
              var entry = {
                name: file,
                path: filepath
              };

              if (err) {
                entry.err = err.stack || err;
                return send();
              } else {
                if (stat.isDirectory()) {
                  entry.mime = "inode/directory";
                  if (fsOptions.httpRoot) {
                    entry.href = fsOptions.httpRoot + filepath.substr(1) + "/";
                  }
                } else if (stat.isBlockDevice()) entry.mime = "inode/blockdevice";
                else if (stat.isCharacterDevice()) entry.mime = "inode/chardevice";
                else if (stat.isSymbolicLink()) entry.mime = "inode/symlink";
                else if (stat.isFIFO()) entry.mime = "inode/fifo";
                else if (stat.isSocket()) entry.mime = "inode/socket";
                else {
                  entry.mime = getMime(filepath);
                  if (fsOptions.httpRoot) {
                    entry.href = fsOptions.httpRoot + filepath.substr(1);
                  }
                }
                entry.access = stat.access;
                entry.size = stat.size;
                if (stat.isFile() || stat.isDirectory()) {
                  entry.etag = calcEtag(stat);
                }


                if (!stat.isSymbolicLink()) {
                  return send();
                }
                fs.readlink(fullpath, function (err, link) {
                  if (err) {
                    entry.linkErr = err.stack;
                  } else {
                    entry.link = link;
                  }
                  send();
                });
              }
              function send() {
                left--;
                stream.emit("data", "\n  " + JSON.stringify(entry) + (left ? ",":""));
                check();
              }
            });
          });
          check();
          function check() {
            if (!left) {
              stream.emit("data", "\n]\n");
              stream.emit("end");
            }
          }
        });
      });
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
          stream.on('close', function () {
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
      statSafe(dirname(path), 2, function (err) {
        if (err) return callback(err);
        fn(path, function (err) {
          if (err) return callback(err);
          return callback(null, meta);
        });
      });
    });
  }

  function rmdir(path, options, callback) {
    // TODO: add recursive delete to options?
    remove(path, fs.rmdir, callback);
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
      statSafe(dir, 2, function (err) {
        if (err) return callback(err);
        // Make sure the source file is accessable
        realpath(options.from, function (err, from) {
          if (err) return callback(err);
          // Make sure the user can modify the source directory
          statSafe(dirname(from), 2, function (err) {
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
    // TODO: possibly add optional feature to convert virtual absolute targets
    // to relative links.
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
};
