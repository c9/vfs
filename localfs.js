var fs = require('fs');
var Stream = require('stream').Stream;
var getMime = require('simple-mime')("application/octet-stream");


exports.createReadStream = createReadStream;
// Like fs.ReadStream, except with added HTTP-like options and an extra "head" event (in the callback)
// options can be:
//   uid, gid - only read the file if this uid and gid are allowed to read it. head gets "forbidden: true" (403) if the read is not allowed.
//   etag - if the file matches the passed in etag, then the body is not emitted and head says "notModified: true"
//   head: true, this is a head request, don't actually send the body, just report what it would be.  "head" event gets "head: true"
//   range - an object with "start" and/or "end" properties - range requests as they mean in HTTP
//       if the body is not the whole file, "partialContent: true" (206) is in the head event.
//       or "rangeNotSatisfiable: true" (416) if there is a problem
// "head" event also contains:
//  mime - a mime type
//  lastModified - mtime as js Date instance
//  etag - etag of resource
//  size - size of body in bytes
//  notFound: (404) true if the file doesn't exist
function createReadStream(path, options, callback) {
  console.log(path, options);
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




// Saves a file to disk
// options can be:
//    uid, gid: save the file as this specified uid and gid if possible head gets "forbidden: true" (403) if this is not allowed. (but hard error if we simply don't have the permissions to do this as them)
//    umask: value to be used when creating the file
function saveFile(path, readableStream, options) {
}