var vfs = require('vfs-local')({
  root: __dirname + "/"
});
watch(vfs);

// var Parent = require('vfs-child').Parent;
// var parent = new Parent({root: __dirname + "/"});
// parent.connect(function (err, vfs) {
//   if (err) throw err;
//   watch(vfs);
// });


function watch(vfs) {
  vfs.watch(".", {}, function (err, meta) {
    if (err) throw err;
    var watcher = meta.watcher;
    watcher.on("change", function (event, filename) {
      console.log("change", event, filename);
    });
    setTimeout(function () {
      console.log("Closing...");
      watcher.close()
    }, 10000);
  });
}

