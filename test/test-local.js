/*global describe:false, it:false */

var expect = require('chai').expect;

describe('vfs-local', function () {

  var root = __dirname + "/mock/";
  var base = root.substr(0, root.length - 1);

  var vfs = require('vfs-local/lint')(require("vfs-local")({
    root: root,
    checkSymlinks: true
  }));

  describe('#resolve()', function () {

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

  describe('#stat()', function () {
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
        expect(err).property("code").equals("ENOENT");
        done();
      });
    });
  });
});

//  readdir: function () {
//    vfs.readdir("/", {}, function (err, meta) {
//      if (err) throw err;
//      console.log(meta);
//      meta.stream.on("data", function (stat) {
//        console.log(stat);
//      });
//      meta.stream.on("end", function () {
//        console.log("DONE");
//        next();
//      });
//    });
//  }
//};
//
