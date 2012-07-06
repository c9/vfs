// var vfs = require('vfs-local')({
//   root: __dirname + "/"
// });
// watch(vfs);
// changed(vfs);

var Parent = require('vfs-child').Parent;
var parent = new Parent({root: __dirname + "/"});
parent.connect(function (err, vfs) {
  if (err) throw err;
  watch(vfs);
  // changed(vfs);
});


function watch(vfs) {
  // vfs.watch(".", {}, onWatch);
  vfs.watch("vfs-watch-example.js", {file:true}, onWatch);
  function onWatch(err, meta) {
    if (err) throw err;
    var watcher = meta.watcher;
    watcher.on("change", function (event, filename) {
      console.log("change", event, filename);
    });
    setTimeout(function () {
      console.log("Closing...");
      watcher.close()
    }, 10000);
  }
}

function changed(vfs) {
  require('fs').readdir(".", function (err, files) {
    vfs.changedSince(files, {since: Date.now() - 30000}, function (err, meta) {
      if (err) throw err;
      console.log(meta);
    });
  })
}

