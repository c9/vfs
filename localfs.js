var fs = require('fs');
var join = require('path').join;
var Stream = require('stream').Stream;
var getMime = require('simple-mime')("application/octet-stream");

// @fsOptions can have:
//   fsOptions.uid,
//   fsOptions.gid - restricts access as if this user was running as
//                   this uid/gid, create files as this user.
//   fsOptions.umask - default umask for creating files
//   fsOptions.root - root path to mount
module.exports = function setup(fsOptions) {
  var root = fsOptions.root || "/";

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
  //     meta.size - the size of the file
  //     meta.etag - the etag of the file (embeds inode, size and mtime)
  //     meta.stream - a readable stream if the response should have a body.
  function createReadStream(path, options, callback) {
    path = join(root, path);
    var meta = {
      mime: getMime(path),
    };
    fs.open(path, "r", function (err, fd) {
      if (err) {
        if (err.code === "ENOENT") {
          meta.notFound = err;
          return callback(null, meta);
        }
        return callback(err);
      }
      fs.fstat(fd, function (err, stat) {
        if (err) return callback(err);

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
  }
  
  return {
    createReadStream: createReadStream,
  };

};
