var jsftp = require('jsftp');

module.exports = function setup(fsOptions) {

	return {
		spawn: spawn,
		connect: connect,
	    readfile: readfile,
	    mkfile: mkfile,
	    rmfile: rmfile,
	    readdir: readdir,
	    mkdir: mkdir,
	    rmdir: rmdir,
	    rename: rename,
	    copy: copy,
	    symlink: symlink
	};

	function spawn(executablePath, options, callback) {
		callback(new Error("FTP Cannot spawn"));
	}

	function connect(port, options, callback) {
		callback(new Error("FTP Cannot connect"));
	}

	function readfile(path, options, callback) {
		var meta = {};
		callback(new Error("Not Implemented"));
	}

	function mkfile(path, options, callback) {
		var meta = {};
		callback(new Error("Not Implemented"));
	}

	function rmfile(path, options, callback) {
		var meta = {};
		callback(new Error("Not Implemented"));
	}

	function readdir(path, options, callback) {
		var meta = {};
		callback(new Error("Not Implemented"));
	}

	function rmdir(path, options, callback) {
		var meta = {};
		callback(new Error("Not Implemented"));
	}

	function rename(path, options, callback) {
		var meta = {};
		callback(new Error("Not Implemented"));
	}

	function copy(path, options, callback) {
		var meta = {};
		callback(new Error("Not Implemented"));
	}

	function symlink(path, options, callback) {
		var meta = {};
		callback(new Error("Not Implemented"));
	}

};