/*global describe:false, it:false */

var expect = require('chai').expect;

describe('vfs-local', function () {

  var root = __dirname + "/mock/";
  var base = root.substr(0, root.length - 1);

  var vfs = require('vfs-local/lint')(require("vfs-local")({
    root: root,
    checkSymlinks: true
  }));

  var fs = require('fs');
  if (!fs.existsSync) fs.existsSync = require('path').existsSync;

  describe('vfs.resolve()', function () {
    it('should prepend root when resolving virtual paths', function (done) {
      var vpath = "/dir/stuff.json";
      vfs.resolve(vpath, {}, function (err, meta) {
        if (err) throw err;
        expect(meta).property("path").equals(base + vpath);
        done();
      });
    });
    it('should reject paths that resolve outside the root', function (done) {
      vfs.resolve("/../test-local.js", {}, function (err, meta) {
        expect(err).property("code").equals("EACCESS");
        done();
      });
    });
    it('should not prepend when already rooted', function (done) {
      var path = base + "/file.txt";
      vfs.resolve(path, { alreadyRooted: true }, function (err, meta) {
        if (err) throw err;
        expect(meta).property("path").equal(path);
        done();
      });
    });
    it('should error with ENOENT when the path is invalid', function (done) {
      vfs.resolve("/notexists.txt", {}, function (err, meta) {
        expect(err).property("code").equals("ENOENT");
        done();
      });
    });
  });

  describe('vfs.stat()', function () {
    it('should return stat info for the text file', function (done) {
      vfs.stat("/file.txt", {}, function (err, stat) {
        if (err) throw err;
        expect(stat).property("name").equal("file.txt");
        expect(stat).property("size").equal(23);
        expect(stat).property("mime").equal("text/plain");
        done();
      });
    });
    it("should error with ENOENT when the file doesn't exist", function (done) {
      vfs.stat("/badfile.json", {}, function (err, stat) {
        expect(err).property("code").equal("ENOENT");
        done();
      });
    });
  });

  describe('vfs.readfile()', function () {
    it("should read the text file", function (done) {
      vfs.readfile("/file.txt", {}, function (err, meta) {
        if (err) throw err;
        expect(meta).property("mime").equals("text/plain");
        expect(meta).property("size").equals(23);
        expect(meta).property("etag");
        expect(meta).property("stream").property("readable");
        var stream = meta.stream;
        var chunks = [];
        var length = 0;
        stream.on("data", function (chunk) {
          chunks.push(chunk);
          length += chunk.length;
        });
        stream.on("end", function () {
          expect(length).equal(23);
          var body = chunks.join("");
          expect(body).equal("This is a simple file!\n");
          done();
        });
      });
    });
    it("should error with ENOENT on missing files", function (done) {
      vfs.readfile("/badfile.json", {}, function (err, stat) {
        expect(err).property("code").equal("ENOENT");
        done();
      });
    });
    it("should error with EISDIR on directories", function (done) {
      vfs.readfile("/", {}, function (err, stat) {
        expect(err).property("code").equal("EISDIR");
        done();
      });
    });
  });

  describe('vfs.readdir()', function () {
    it("should read the directory", function (done) {
      vfs.readdir("/", {}, function (err, meta) {
        if (err) throw err;
        expect(meta).property("etag");
        expect(meta).property("stream").property("readable");
        var stream = meta.stream;
        var parts = [];
        stream.on("data", function (part) {
          parts.push(part);
        });
        stream.on("end", function () {
          expect(parts).length(5);
          done();
        });
      });
    });
    it("should error with ENOENT when the folder doesn't exist", function (done) {
      vfs.readdir("/fake", {}, function (err, meta) {
        expect(err).property("code").equal("ENOENT");
        done();
      });
    });
    it("should error with ENOTDIR when the path is a file", function (done) {
      vfs.readdir("/file.txt", {}, function (err, meta) {
        expect(err).property("code").equal("ENOTDIR");
        done();
      });
    });
  });

  describe('vfs.mkfile()', function () {
    it("should create a file using using readble in options", function (done) {
      var stream = fs.createReadStream(__filename);
      var vpath = "/test.js";
      // Make sure the file doesn't exist.
      expect(fs.existsSync(base + vpath)).not.ok;
      vfs.mkfile(vpath, { stream: stream }, function (err, meta) {
        if (err) {
          fs.unlinkSync(base + vpath);
          return done(err);
        }
        var actual = fs.readFileSync(base + vpath, "utf8");
        var original = fs.readFileSync(__filename, "utf8");
        fs.unlinkSync(base + vpath);
        expect(actual).equal(original);
        done();
      });
    });
    it("should create a file using writable in callback", function (done) {
      var vpath = "/test.js";
      // Make sure the file doesn't exist.
      expect(fs.existsSync(base + vpath)).not.ok;
      vfs.mkfile(vpath, {}, function (err, meta) {
        if (err) {
          fs.unlinkSync(base + vpath);
          return done(err);
        }
        expect(meta).property("stream").property("writable").ok;
        var writable = meta.stream;
        var readable = fs.createReadStream(__filename);
        readable.pipe(writable);
        writable.on("saved", function () {
          var actual = fs.readFileSync(base + vpath, "utf8");
          var original = fs.readFileSync(__filename, "utf8");
          fs.unlinkSync(base + vpath);
          expect(actual).equal(original);
          done();
        });
      });
    });
    it("should update an existing file using readble in options", function (done) {
      var vpath = "/changeme.txt";
      var stream = fs.createReadStream(__filename);
      fs.writeFileSync(base + vpath, "Original Content\n");
      vfs.mkfile(vpath, {stream: stream}, function (err, meta) {
        if (err) {
          fs.unlinkSync(base + vpath);
          return done(err);
        }
        var actual = fs.readFileSync(base + vpath, "utf8");
        var original = fs.readFileSync(__filename, "utf8");
        fs.unlinkSync(base + vpath);
        expect(actual).equal(original);
        done();
      });
    }),
    it("should update an existing file using writable in callback", function (done) {
      var vpath = "/changeme.txt";
      fs.writeFileSync(base + vpath, "Original Content\n");
      vfs.mkfile(vpath, {}, function (err, meta) {
        if (err) {
          fs.unlinkSync(base + vpath);
          return done(err);
        }
        expect(meta).property("stream").property("writable").ok;
        var writable = meta.stream;
        var readable = fs.createReadStream(__filename);
        readable.pipe(writable);
        writable.on("saved", function () {
          var actual = fs.readFileSync(base + vpath, "utf8");
          var original = fs.readFileSync(__filename, "utf8");
          fs.unlinkSync(base + vpath);
          expect(actual).equal(original);
          done();
        });
      });
    });
  });

  describe('vfs.mkdir()', function () {
    it("should create a directory", function (done) {
      var vpath = "/newdir";
      // Make sure it doesn't exist yet
      expect(fs.existsSync(base + vpath)).not.ok;
      vfs.mkdir(vpath, {}, function (err, meta) {
        if (err) {
          fs.rmdirSync(base + vpath);
          return done(err);
        }
        expect(fs.existsSync(base + vpath)).ok;
        fs.rmdirSync(base + vpath);
        done();
      });
    });
    it("should error with EEXIST when the directory already exists", function (done) {
      vfs.mkdir("/dir", {}, function (err, meta) {
        expect(err).property("code").equal("EEXIST");
        done();
      });
    });
    it("should error with EEXIST when the file already exists", function (done) {
      vfs.mkdir("/file.txt", {}, function (err, meta) {
        expect(err).property("code").equal("EEXIST");
        done();
      });
    });
  });

  describe('vfs.rmfile()', function () {
    it("should delete a file", function (done) {
      var vpath = "/deleteme.txt";
      fs.writeFileSync(base + vpath, "DELETE ME!\n");
      expect(fs.existsSync(base + vpath)).ok;
      vfs.rmfile(vpath, {}, function (err, meta) {
        if (err) throw err;
        expect(fs.existsSync(base + vpath)).not.ok;
        done();
      });
    });
    it("should error with ENOENT if the file doesn't exist", function (done) {
      var vpath = "/badname.txt";
      expect(fs.existsSync(base + vpath)).not.ok;
      vfs.rmfile(vpath, {}, function (err, meta) {
        expect(err).property("code").equal("ENOENT");
        done();
      });
    });
    it("should error with EISDIR if the path is a directory", function (done) {
      var vpath = "/dir";
      expect(fs.existsSync(base + vpath)).ok;
      vfs.rmfile(vpath, {}, function (err, meta) {
        expect(err).property("code").equal("EISDIR");
        done();
      });
    });
  });

  describe('vfs.rmdir()', function () {
    it("should delete a file", function (done) {
      var vpath = "/newdir";
      fs.mkdirSync(base + vpath);
      expect(fs.existsSync(base + vpath)).ok;
      vfs.rmdir(vpath, {}, function (err, meta) {
        if (err) throw err;
        expect(fs.existsSync(base + vpath)).not.ok;
        done();
      });
    });
    it("should error with ENOENT if the file doesn't exist", function (done) {
      var vpath = "/badname.txt";
      expect(fs.existsSync(base + vpath)).not.ok;
      vfs.rmdir(vpath, {}, function (err, meta) {
        expect(err).property("code").equal("ENOENT");
        done();
      });
    });
    it("should error with ENOTDIR if the path is a file", function (done) {
      var vpath = "/file.txt";
      expect(fs.existsSync(base + vpath)).ok;
      vfs.rmdir(vpath, {}, function (err, meta) {
        expect(err).property("code").equal("ENOTDIR");
        done();
      });
    });
  });

  describe('vfs.rename()', function () {
    it("should rename a file using options.to", function (done) {
      var before = "/start.txt";
      var after = "/end.txt";
      var text = "Move me please\n";
      fs.writeFileSync(base + before, text);
      expect(fs.existsSync(base + before)).ok;
      expect(fs.existsSync(base + after)).not.ok;
      vfs.rename(before, {to: after}, function (err, meta) {
        if (err) throw err;
        expect(fs.existsSync(base + before)).not.ok;
        expect(fs.existsSync(base + after)).ok;
        expect(fs.readFileSync(base + after, "utf8")).equal(text);
        fs.unlinkSync(base + after);
        done();
      });
    });
    it("should rename a file using options.from", function (done) {
      var before = "/start.txt";
      var after = "/end.txt";
      var text = "Move me please\n";
      fs.writeFileSync(base + before, text);
      expect(fs.existsSync(base + before)).ok;
      expect(fs.existsSync(base + after)).not.ok;
      vfs.rename(after, {from: before}, function (err, meta) {
        if (err) throw err;
        expect(fs.existsSync(base + before)).not.ok;
        expect(fs.existsSync(base + after)).ok;
        expect(fs.readFileSync(base + after, "utf8")).equal(text);
        fs.unlinkSync(base + after);
        done();
      });
    });
    it("should error with ENOENT if the source doesn't exist", function (done) {
      vfs.rename("/notexist", {to:"/newname"}, function (err, meta) {
        expect(err).property("code").equal("ENOENT");
        done();
      });
    });
  });

  describe('vfs.copy()', function () {
    it("should copy a file using options.to", function (done) {
      var source = "/file.txt";
      var target = "/copy.txt";
      var text = fs.readFileSync(base + source, "utf8");
      vfs.copy(source, {to: target}, function (err, meta) {
        if (err) throw err;
        expect(fs.existsSync(base + target)).ok;
        expect(fs.readFileSync(base + target, "utf8")).equal(text);
        fs.unlinkSync(base + target);
        done();
      });
    });
    it("should copy a file using options.from", function (done) {
      var source = "/file.txt";
      var target = "/copy.txt";
      var text = fs.readFileSync(base + source, "utf8");
      vfs.copy(target, {from: source}, function (err, meta) {
        if (err) throw err;
        expect(fs.existsSync(base + target)).ok;
        expect(fs.readFileSync(base + target, "utf8")).equal(text);
        fs.unlinkSync(base + target);
        done();
      });
    });
    it("should error with ENOENT if the source doesn't exist", function (done) {
      vfs.copy("/badname.txt", {to:"/copy.txt"}, function (err, meta) {
        expect(err).property("code").equal("ENOENT");
        done();
      });
    });
  });

  describe('vfs.symlink()', function () {
    it("should create a symlink", function (done) {
      var target = "file.txt";
      var vpath = "/newlink.txt";
      var text = fs.readFileSync(root + target, "utf8");
      vfs.symlink(vpath, {target: target}, function (err, meta) {
        if (err) throw err;
        expect(fs.readFileSync(base + vpath, "utf8")).equal(text);
        fs.unlinkSync(base + vpath);
        done();
      });
    });
    it("should error with EEXIST if the file already exists", function (done) {
      vfs.symlink("/file.txt", {target:"/this/is/crazy"}, function (err, meta) {
        expect(err).property("code").equal("EEXIST");
        done();
      });
    });
  });

  describe('vfs.watch()', function () {
    it("should notice a directly watched file change", function (done) {
      var vpath = "/newfile.txt";
      expect(fs.existsSync(base + vpath)).not.ok;
      var writable = fs.createWriteStream(base + vpath);
      vfs.watch(vpath, {}, function (err, meta) {
        if (err) throw err;
        expect(meta).property("watcher").ok;
        var watcher = meta.watcher;
        watcher.on("change", function (event, filename) {
          watcher.close();
          expect(event).equal("change");
          expect(filename).equal(vpath.substr(1));
          writable.end();
          writable.on("close", function () {
            fs.unlinkSync(base + vpath);
            done();
          });
        });
        writable.write("Change!");
      });
    });
    it("should notice a new file in a watched directory", function (done) {
      var vpath = "/newfile.txt";
      expect(fs.existsSync(base + vpath)).not.ok;
      vfs.watch("/", {}, function (err, meta) {
        if (err) throw err;
        expect(meta).property("watcher").ok;
        var watcher = meta.watcher;
        watcher.on("change", function (event, filename) {
          watcher.close();
          expect(event).ok;
          expect(filename).equal(vpath.substr(1));
          fs.unlinkSync(base + vpath);
          done();
        });
        fs.writeFileSync(base + vpath, "newfile!");
      });
    });
  });

  describe('vfs.connect()', function () {
    var net = require('net');
    it("should connect to a tcp server and ping-pong", function (done) {
      var stream;
      var server = net.createServer(function (client) {
        client.setEncoding('utf8');
        client.once("data", function (chunk) {
          expect(chunk).equal("ping");
          stream.once("data", function (chunk) {
            expect(chunk).equal("pong");
            client.end();
            stream.end();
            server.close();
            done();
          });
          client.write("pong");
        });
      });
      server.listen(function () {
        var port = server.address().port;
        vfs.connect(port, {encoding:"utf8"}, function (err, meta) {
          if (err) throw err;
          expect(meta).property("stream").ok;
          stream = meta.stream;
          stream.write("ping");
        });
      });
    });
  });

  describe('vfs.spawn()', function () {
    it("should spawn a child process", function (done) {
      var args = ["-e", "process.stdin.pipe(process.stdout);process.stdin.resume();"];
      vfs.spawn(process.execPath, {args: args, stdoutEncoding: "utf8"}, function (err, meta) {
        if (err) throw err;
        expect(meta).property("process").ok;
        var child = meta.process;
        expect(child).property("stdout").ok;
        expect(child).property("stdin").ok;
        child.stdout.on("data", function (chunk) {
          expect(chunk).equal("echo me");
          child.stdout.on("end", function () {
            done();
          });
          child.stdin.end();
        });
        child.stdin.write("echo me");
      });
    });
  });

  describe('vfs.execFile()', function () {
    it("should exec a child process", function (done) {
      var args = ["-p", "-e", "process.version"];
      vfs.execFile(process.execPath, {args:args}, function (err, meta) {
        if (err) throw err;
        expect(meta).property("stdout").equal(process.version + "\n");
        expect(meta).property("stderr").equal("");
        done();
      });
    });
  });

  describe('vfs.on(), vfs.off(), vfs.emit()', function () {
    it ("should register an event listener and catch an event", function (done) {
      vfs.on("myevent", onEvent, function (err) {
        if (err) throw err;
        vfs.emit("myevent", 42, function (err) {
          if (err) throw err;
        });
      });
      function onEvent(data) {
        expect(data).equal(42);
        vfs.off("myevent", onEvent, done);
      }
    });
    it("should catch multiple events of the same type", function (done) {
      var times = 0;
      vfs.on("myevent", onEvent, function (err) {
        if (err) throw err;
        vfs.emit("myevent", 43, function (err) {
          if (err) throw err;
        });
        vfs.emit("myevent", 43, function (err) {
          if (err) throw err;
        });
      });
      function onEvent(data) {
        expect(data).equal(43);
        if (++times === 2) {
          vfs.off("myevent", onEvent, done);
        }
      }
    });
    it("should call multiple listeners for a single event", function (done) {
      var times = 0;
      vfs.on("myevent", onEvent1, function (err) {
        if (err) throw err;
        vfs.on("myevent", onEvent2, function (err) {
          if (err) throw err;
          vfs.emit("myevent", 44, function (err) {
            if (err) throw err;
          });
        });
      });
      function onEvent1(data) {
        expect(data).equal(44);
        times++;
      }
      function onEvent2(data) {
        expect(data).equal(44);
        if (++times === 2) {
          vfs.off("myevent", onEvent1, function (err) {
            if (err) throw err;
            vfs.off("myevent", onEvent2, done);
          });
        }
      }
    });
    it("should stop listening after a handler is removed", function (done) {
      vfs.on("myevent", onEvent, function (err) {
        if (err) throw err;
        vfs.emit("myevent", 45, function (err) {
          if (err) throw err;
          vfs.off("myevent", onEvent, function (err) {
            if (err) throw err;
            vfs.emit("myevent", 46, done);
          });
        });
      });
      function onEvent(data) {
        expect(data).equal(45);
      }
    });
  });
});
