var fs = require('fs');
var join = require('path').join;
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

// @fsOptions can have:
//   fsOptions.uid - restricts access as if this user was running as
//   fsOptions.gid   this uid/gid, create files as this user.
//   fsOptions.umask - default umask for creating files
//   fsOptions.root - root path to mount, this needs to be realpath'ed or it won't work.
module.exports = function setup(fsOptions) {
  var root = fsOptions.root || "/";
  var umask = fsOptions.umask || 0750;
  var checkPermissions;
  if (fsOptions.hasOwnProperty("uid") || fsOptions.hasOwnProperty("gid")) {
    if (process.getuid() > 0) {
      throw new Error("uid and/or gid specified, but not running as root");
    }
    checkPermissions = true;
  }
  
  // Realpath, open, and stat a file
  // Doing security checks along the way.
  // callback(err, path, fd, stat)
  function open(path, mode, flags, callback) {
    fs.realpath(join(root, path), function (err, path) {
      if (err) return callback(err);
      if (path.substr(0, root.length) !== root) {
        var err = new Error("ENOENT: '" + path + "' not in '" + root + "'");
        err.code = "ENOENT";
        return callback(err);
      }
      fs.open(path, mode, flags, function (err, fd) {
        if (err) return callback(err);
        fs.fstat(fd, function (err, stat) {
          if (err) return callback(err);
          if (checkPermissions && !canRead(fsOptions.uid === stat.uid, fsOptions.gid === stat.gid, stat.mode)) {
            var err = new Error("EACCESS: Permission Denied");
            err.code = "EACCESS";
            return callback(err);
          }
          return callback(null, path, fd, stat);
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

      // Basic file info
      meta.mime = getMime(path);
      meta.size = stat.size;
      meta.etag = '"' + stat.ino.toString(32) + "-" + stat.size.toString(32) + "-" + stat.mtime.valueOf().toString(32) + '"';
      
      // ETag support
      if (options.etag === meta.etag) {
        meta.notModified = true;
        return callback(null, meta);
      }

      // Range support
      if (options.hasOwnProperty('range') && !(options.range.etag && options.range.etag !== meta.etag)) {
        var range = options.range;
        var start = range.hasOwnProperty("start") ? range.start : 0;
        var end = range.hasOwnProperty("end") ? range.end : stat.size - 1;
        if (end < start || start < 0 || end >= stat.size) {
          meta.rangeNotSatisfiable = "Range out of bounds";
          return callback(null, meta);
        }
        options.start = start;
        options.end = end;
        meta.size = end - start + 1;
        meta.partialContent = { start: start, end: end, size: stat.size };
      }
      
      // HEAD request support
      if (options.hasOwnProperty("head")) {
        return callback(null, meta);
      }
      
      // Read the file as a stream
      try {
        options.fd = fd;
        meta.stream = new fs.ReadStream(path, options);
      } catch (err) {
        return callback(err);
      }
      callback(null, meta);
    });
  }

  function readdir(path, options, callback) {
    var meta = {};
    
    open(path, "r", umask & 0777, function (err, path, fd, stat) {
      if (err) return callback(err);
      
    });

  }
  
  
  return {
    createReadStream: createReadStream,
    readdir: readdir,
  };

};
