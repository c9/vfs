var vfs = require('vfs-local')({root:__dirname + "/"});
var fs = require('fs');

// Read from string
fs.readFile(__dirname + "/extension.js", "utf8", function (err, code) {
 if (err) throw err;
 vfs.extend("math", {code: code}, function (err, meta) {
     console.log("extend1", meta);
     if (err) throw err;
     meta.api.add(3, 5, function (err, result) {
         if (err) throw err;
         console.log("RESULT1", result);
     });
 });
});

// Read from stream
vfs.extend("math2", {stream: fs.createReadStream(__dirname + "/extension.js")}, function (err, meta) {
 console.log("extend2", meta);
 if (err) throw err;
 meta.api.add(3, 5, function (err, result) {
     if (err) throw err;
     console.log("RESULT2", result);
 });
});

// Read from a file
vfs.extend("math3", {file: __dirname + "/extension.js"}, function (err, meta) {
    if (err) throw err;
    console.log("extend3", meta);
    meta.api.add(3, 5, function (err, result) {
        if (err) throw err;
        console.log("RESULT3", result);
    });


    // Read from the cache
    vfs.extend("math3", {}, function (err, meta) {
        if (err) throw err;
        console.log("extend4", meta);
        meta.api.add(3, 5, function (err, result) {
            if (err) throw err;
            console.log("RESULT3", result);
        });
    });

});

