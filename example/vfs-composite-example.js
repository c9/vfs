
var vfsLocal = require('vfs-local');

var vfsLocal = vfsLocal({root: process.env.HOME + "/"});

var vfs = require('vfs-composite')(
	{ root: "/home/", vfs: vfsLocal },
	{ root: "/home/tim/", vfs: vfsLocal, readOnly: true }
);

vfs.mount({ root: "/", vfs: vfsLocal, prefix: "/Desktop/" });

console.log(vfs);

require('http').createServer(require('stack')(
	require('vfs-http-adapter')("/", vfs)
)).listen(8080, function () {
	console.log("Composite vfs server listening");
	vfs.mounts.forEach(function (mount) {
		console.log("http://localhost:8080" + mount.root, Object.keys(mount).filter(function (key) {
			return key !== "vfs";
		}).map(function (key) {
			return key + "=" + JSON.stringify(mount[key]);
		}).join(" "));
	});
});