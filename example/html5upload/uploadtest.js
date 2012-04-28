var target = document.getElementById("target");
target.addEventListener('drop', onDrop, false);
target.addEventListener('dragover', onDragover, false);

var progressBar = document.querySelector("progress");

var timer = document.getElementById("timer");
var timerLog = document.getElementById("timerlog");
var before = Date.now();
setInterval(function () {
    var now = Date.now();
    var delta = now - before;
    if (delta > 101) {
        timerLog.textContent += delta + "\n";
    }
    before = now;
    timer.textContent = Date.now() + " : " + (delta);
}, 100);

function onDragover(evt) {
    evt.stopPropagation();
    evt.preventDefault();
    evt.dataTransfer.dropEffect = 'copy';
}

function onDrop(evt) {
    evt.stopPropagation();
    evt.preventDefault();
    target.style.borderColor = "#f00";
    post(evt.dataTransfer.files);
    target.style.borderColor = "#00f";
}

function put(files) {

    // var size = file.size;
    // var mtime = file.lastModifiedDate;

    Array.prototype.slice.call(files).forEach(function (file) {
        var xhr = new XMLHttpRequest();
        xhr.open('PUT', '/dump/' + file.name, true);
        xhr.onload = function(e) {
            console.log("onload", e);
        };

        xhr.upload.onprogress = function(e) {
            if (e.lengthComputable) {
                progressBar.value = (e.loaded / e.total) * 100;
                progressBar.textContent = progressBar.value;
            }
        };

        xhr.send(file);
    });
}


function post(files) {
    var xhr = new XMLHttpRequest();
    var fd = new FormData();  
    xhr.open('POST', '/dump/', true);
    for (var i = 0, l = files.length; i < l; i++) {
        var file = files[i];
        fd.append(file.name, file);  
    }

    xhr.upload.onprogress = function(e) {
        if (e.lengthComputable) {
            progressBar.value = (e.loaded / e.total) * 100;
            progressBar.textContent = progressBar.value;
        }
    };
    xhr.onload = function(e) {
        progressBar.value = 100;
        progressBar.textContent = progressBar.value;
        target.style.borderColor = "#0f0";
    };

    xhr.send(fd);  

}