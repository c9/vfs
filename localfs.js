var fs = require('fs');
var join = require('path').join;
var Stream = require('stream').Stream;
var getMime = require('simple-mime')("application/octet-stream");

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
//   fsOptions.uid,
//   fsOptions.gid - restricts access as if this user was running as
//                   this uid/gid, create files as this user.
//   fsOptions.umask - default umask for creating files
//   fsOptions.root - root path to mount
module.exports = function setup(fsOptions) {
  var root = fs.realpathSync(fsOptions.root || "/");
  var checkPermissions;
  if (fsOptions.hasOwnProperty("uid") || fsOptions.hasOwnProperty("gid")) {
    if (process.getuid() > 0) {
      throw new Error("uid and/or gid specified, but not running as root");
    }
    checkPermissions = true;
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
  //   err is truthy if there is a server error and the browser should send 500
  //   meta in the callback has:
  //     meta.notFound - truthy if the server should send 404 (file isn't found)
  //     meta.notModified - truthy if the server should send 304 (etag matched)
  //     meta.rangeNotSatisfiable - truthy if the server should send 416
  //     meta.partialContent - object if server should send 206 and contains 
  //          "start", "end", and "size" needed for the "Content-Range" header.
  //     meta.forbidden - specified uid and gid can't read the file.
  //     meta.size - the size of the file
  //     meta.etag - the etag of the file (embeds inode, size and mtime)
  //     meta.stream - a readable stream if the response should have a body.
  function createReadStream(path, options, callback) {
    var meta = {
      mime: getMime(path),
    };
    
    function reportError(err) {
      if (err.code === "ENOENT") {
        meta.notFound = err;
        return callback(null, meta);
      }
      if (err.code === "EACCES") {
        meta.forbidden = err;
        return callback(null, meta);
      }
      return callback(err);
    }
    
    fs.realpath(join(root, path), function (err, path) {
      if (err) return reportError(err);
      // Make sure the resolved path is within the declared root.
      if (path.substr(0, root.length) !== root) {
        meta.notFound = "Invalid path";
        return callback(null, meta);
      }
      fs.open(path, "r", function (err, fd) {
        if (err) return reportError(err);
        fs.fstat(fd, function (err, stat) {
          if (err) return reportError(err);
  
          if (checkPermissions && !canRead(fsOptions.uid === stat.uid, fsOptions.gid === stat.gid, stat.mode)) {
            meta.forbidden = "Permission Denied";
            return callback(null, meta);
          }

          meta.size = stat.size;
          meta.etag = '"' + stat.ino.toString(32) + "-" + stat.size.toString(32) + "-" + stat.mtime.valueOf().toString(32) + '"';
          
          if (options.etag === meta.etag) {
            meta.notModified = true;
            return callback(null, meta);
          }

          if (options.hasOwnProperty('range') && !(options.range.etag && options.range.etag !== meta.etag)) {
            var start = 0, end = stat.size - 1;
            if (options.range.hasOwnProperty("start")) {
              start = options.range.start;
            }
            if (options.range.hasOwnProperty("end")) {
              end = options.range.end;
            }

            var message;
            if (end < start) message = "start after end";
            if (start < 0) message = "start before 0";
            if (end >= stat.size) message = "end after length";
            if (message) {
              meta.rangeNotSatisfiable = message;
              return callback(null, meta);
            }
            
            options.start = start;
            options.end = end;
            meta.size = end - start + 1;
            meta.partialContent = { start: start, end: end, size: stat.size };
          }
          
          // Skip the body for head requests
          if (options.hasOwnProperty("head")) {
            return callback(null, meta);
          }
          
          // Create the stream and pass it along
          try {
            options.fd = fd;
            meta.stream = new fs.ReadStream(path, options);
          } catch (err) {
            return callback(err);
          }
          callback(null, meta);
        });
      });
    
    });
  }
  
  return {
    createReadStream: createReadStream,
  };

};
