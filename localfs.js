var fs = require('fs');
var join = require('path').join;
var dirname = require('path').dirname;
var basename = require('path').basename;
var Stream = require('stream').Stream;
var getMime = require('simple-mime')("application/octet-stream");

// Functions useful for matching users and permissions
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
function canOpen(flag, owner, inGroup, mode) {
  if (flag[flag.length - 1] === "+") {
    return canRead(owner, inGroup, mode) && canWrite(owner, inGroup, mode);
  }
  if (flag.toLowerCase() === 'r') return canRead(owner, inGroup, mode);
  return canWrite(owner, inGroup, mode);
}
function canAccess(path, uid, gid, callback) {
  var dir = dirname(path);
  fs.stat(dir, function (err, stat) {
    if (err) return callback(err);
    if (!canExec(uid === stat.uid, gid === stat.gid, stat.mode)) {
      return callback(null, false);
    }
    if (dir === "/") {
      return callback(null, true);
    }
    canAccess(dir, uid, gid, callback);
  });
}

function calcEtag(stat) {
  return '"' + stat.ino.toString(32) + "-" + stat.size.toString(32) + "-" + stat.mtime.valueOf().toString(32) + '"';
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
  var checkPermissions;
  if (fsOptions.hasOwnProperty("uid") || fsOptions.hasOwnProperty("gid")) {
    if (process.getuid() > 0) {
      throw new Error("uid and/or gid specified, but not running as root");
    }
    checkPermissions = true;
  }
  
  // Realpath a file and check for access
  // callback(err, path)
  function realpath(path, callback) {
    fs.realpath(join(root, path), function (err, path) {
      if (err) return callback(err);
      if (!(path === base || path.substr(0, root.length) === root)) {
        var err = new Error("EACCESS: '" + path + "' not in '" + root + "'");
        err.code = "EACCESS";
        return callback(err);
      }
      if (!checkPermissions || fsOptions.skipSearchCheck) {
        return callback(null, path);
      } else {
        canAccess(path, fsOptions.uid, fsOptions.gid, function (err, access) {
          if (err) return callback(err);
          if (!access) {
            var err = new Error("EACCESS: Access Denied");
            err.code = "EACCESS";
            return callback(err);
          }
          callback(null, path);
        });
      }
    });
  }
  
  // Realpath, open, and stat a file
  // Doing security checks along the way.
  // callback(err, path, fd, stat)
  function open(path, mode, flags, callback) {
    realpath(path, function (err, path) {
      if (err) return callback(err);
      fs.open(path, mode, flags, function (err, fd) {
        if (err) return callback(err);
        fs.fstat(fd, function (err, stat) {
          if (err) return callback(err);
          if (checkPermissions && !canOpen(mode, fsOptions.uid === stat.uid, fsOptions.gid === stat.gid, stat.mode)) {
            var err = new Error("EACCESS: Permission Denied");
            err.code = "EACCESS";
            return callback(err);
          }
          return callback(null, path, fd, stat);
        });
      });
    });
  }
  
  // Like open above, except just does stat
  // Also shows symlinks and declares allowed permissions
  // Realpath and stat a file
  // Doing security checks along the way.
  // callback(err, path, stat)
  function lstat(path, callback) {
    var filename = basename(path);
    realpath(dirname(path), function (err, dir) {
      if (err) return callback(err);
      var path = join(dir, filename);
      fs.lstat(path, function (err, stat) {
        if (err) return callback(err);
        if (fsOptions.skipSearchCheck || !checkPermissions) {
          return finish();
        }
        fs.stat(dir, function (err, dstat) {
          if (err) return callback(err);
          if (!canExec(fsOptions.uid === dstat.uid, fsOptions.gid === dstat.gid, dstat.mode)) {
            var err = new Error("EACCESS: Access Denied");
            err.code = "EACCESS";
            return callback(err);
          }
          finish();
        });

        function finish() {
          if (checkPermissions) {
            var owner = fsOptions.uid === stat.uid;
            var inGroup = fsOptions.gid === stat.gid;
            stat.access = (canRead(owner, inGroup, stat.mode) ? 4 : 0) +
                          (canWrite(owner, inGroup, stat.mode) ? 2 : 0) +
                          (canExec(owner, inGroup, stat.mode) ? 1 : 0);
          }
          callback(null, path, stat);
        }
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
  //                   "start" and/or "end"
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
  function createReadStream(path, options, callback) {
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
    
    open(path, "r", umask & 0777, function (err, path, fd, stat) {
      if (err) return callback(err);
      fs.close(fd);
      if (!stat.isDirectory()) {
        return callback(new Error("Requested resource is not a directory"));
      }

      meta.etag = 'W/' + calcEtag(stat);

      // ETag support
      if (options.etag === meta.etag) {
        meta.notModified = true;
        return callback(null, meta);
      }

      fs.readdir(path, function (err, files) {
        if (err) return callback(err);
        var stream = new Stream();
        stream.readable = true;
        meta.mime = "application/json";
        meta.stream = stream;
        callback(null, meta);
        stream.emit("data", "[");
        var left = files.length;
        files.forEach(function (file) {
          var filepath = join(path.substr(base.length), file);
          if (filepath[0] !== "/") filepath = "/" + filepath;
          lstat(filepath, function (err, path, stat) {
            var entry = {
              name: file,
              path: filepath,
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
              entry.etag = calcEtag(stat);
            
              if (!stat.isSymbolicLink()) {
                return send();
              }
              fs.readlink(path, function (err, link) {
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
            stream.emit("end")
          }
        }
      });
    }, true);
  }
  
  return {
    createReadStream: createReadStream,
    readdir: readdir,
  };

};
