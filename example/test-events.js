// // Test real version
// var vfs = require('vfs-local')({
//   root: __dirname + "/"
// });
// test(vfs);

// Test socket proxied version
var Parent = require('vfs-child').Parent;
var parent = new Parent({root: __dirname + "/"});
parent.connect(function (err, vfs) {
  if (err) throw err;
  test(vfs);
});

function test(vfs) {
  vfs.on("MONKEY", onMonkey, function () {
    console.log("MONKEY is registered");
    vfs.emit("MONKEY", "EATS BANANNAS", function () {
      console.log("MONKEY is emitted");
      vfs.off("MONKEY", onMonkey, function () {
        console.log("MONKEY is no longer listening");
        vfs.emit("MONKEY", "IS NOT LISTENING");
      });
    });
  });
}

function onMonkey(message) {
  console.log("MONKEY %s", message);
}

