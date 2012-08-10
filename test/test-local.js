/*global describe:false, it:false */

var expect = require('chai').expect;

describe('vfs-local', function () {

  var root = __dirname + "/mock/";
  var base = root.substr(0, root.length - 1);

  var vfs = require('vfs-local/lint')(require("vfs-local")({
    root: root,
    checkSymlinks: true
  }));

  describe('vfs.resolve()', function () {

    it('should prepend root when resolving virtual paths', function (done) {
      var vpath = "/dir/stuff.json";
      vfs.resolve(vpath, {}, function (err, meta) {
        if (err) return done(err);
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
        if (err) return done(err);
        expect(meta).property("path").equal(path);
        done();
      });
    });
  });

  describe('vfs.stat()', function () {
    it('should return stat info for the text file', function (done) {
      vfs.stat("/file.txt", {}, function (err, stat) {
        if (err) return done(err);
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
        if (err) return done(err);
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
  });

  describe('vfs.readdir()', function () {
    it("should read the directory", function (done) {
      vfs.readdir("/", {}, function (err, meta) {
        if (err) return done(err);
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
  });

});
