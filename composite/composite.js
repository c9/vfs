var Stream = require('stream').Stream;

module.exports = function () {
    var mounts = [];

    // Allow passing
    for (var i = 0, l = arguments.length; i < l; i++) {
        mount(arguments[i]);
    }

    return {
        mounts: mounts,
        readfile: route("readfile"),
        readdir: route("readdir"),
        stat: route("stat"),
        realpath: route("realpath"),
        mkfile: route("mkfile", true),
        mkdir: route("mkdir", true),
        rmfile: route("rmfile", true),
        rmdir: route("rmdir", true),
        rename: route("rename", true),
        copy: route("copy", true),
        symlink: route("symlink", true),
        mount: mount
    };

    function route(name, isWrite) {
        return function (path, options, callback) {
            // Find all the matches.
            var matches = [];
            for (var i = 0, l = mounts.length; i < l; i++) {
                var mount = mounts[i];
                var root = mount.root;
                if (root === path.substr(0, root.length)) {
                    matches.push(mount);
                }
            }
            // Async recursive loop over matches
            var index = 0;
            (function next() {
                var mount = matches[index++];
                if (!mount) return notFound();

                // Implement readOnly guard
                if (mount.readOnly && isWrite) return notAllowed(mount);

                // Do path adjustments
                var virtualPath = path.substr(mount.root.length - 1);
                if (mount.prefix) virtualPath = mount.prefix + virtualPath.substr(1);

                mount.vfs[name](virtualPath, options, function (err, meta) {
                    if (err) {
                        if (err.code === "ENOENT" && mount.fallthrough) {
                            return next();
                        }
                        return callback(err);
                    }


					// Path transformation logic
					if( mount.transformReturnPaths === true ) {

						switch( name ) {

							case "readdir":
								if( meta.stream !== undefined && meta.stream !== null ) {
									meta.stream = getPathTransformerProxy( name, mount, meta );
								}
								break;

							case "stat":
								if( meta.path !== undefined ) {
									meta.path = transformPath( mount, meta.path );
								}
								break;

						}

					}
					// End path transformation logic


                    return callback(null, meta);
                });
            }());

            function notFound() {
                var err = new Error("ENOENT: Path does not match any mount.");
                err.path = path;
                err.code = "ENOENT";
                callback(err);
            }

            function notAllowed(mount) {
                var err = new Error("EACCESS: Attempt to write to readonly mount.");
                err.path = path;
                err.mount = mount;
                err.code = "EACCESS";
                callback(err);
            }
        }
    }

    // Insert the mount, but keep sorted by longest root first.
    // Accepts either (mount) or (root, vfs, options)
    function mount(mount) {
        if (!mount.root) throw new Error("Mount must contain a root");
        if (!mount.vfs) throw new Error("Mount must contain a vfs instance");

		// options.transformReturnPaths
		// when TRUE paths will be transformed into
		// an appropriate composite path before being
		// returned to the implementor.
		if( mount.transformReturnPaths === undefined ||
			mount.transformReturnPaths === false ||
			mount.transformReturnPaths === null ) {
			mount.transformReturnPaths = false;
		} else {
			mount.transformReturnPaths = true;
		}
		// end options.transformReturnPaths

        var root = mount.root;
        if (root.substr(root.length - 1) !== "/") {
            throw new Error("Root must end in /");
        }
        if (mount.prefix && mount.prefix.substr(mount.prefix.length - 1) !== "/") {
            throw new Error("Prefix option must end in /");
        }
        for (var i = 0, l = mounts.length; i < l; i++) {
            if (root > mounts[i].root) {
                // Insert it inside
                mounts.splice(i, 0, mount);
                return;
            }
        }
        mounts[i] = mount;
    }
};

/**
 * Creates a proxy stream that transforms incoming
 * file and directory paths to their appropriate
 * composite path.
 *
 * @param {string} name
 * @param {object} mount
 * @param {object} meta
 * @param {Stream} meta.stream
 * @returns {Stream}
 */
function getPathTransformerProxy( name, mount, meta ) {

	// Init
	var originalStream = meta.stream;

	// Setup the proxy/transform stream
	var proxyStream = new Stream();
	proxyStream.readable = true;

	// Transform path
	originalStream.on("data", function( part ) {
		if( part.path !== undefined ) {
			part.path = transformPath( mount, part.path );
		}
		proxyStream.emit("data",part);
	});

	// Forward this event verbatim
	originalStream.on("end", function() {
		proxyStream.emit("end");
	});

	// Forward these methods verbatim
	proxyStream.pause = function () {
		originalStream.pause;
	};
	proxyStream.resume = function () {
		originalStream.resume;
	};

	// Return the new stream
	return proxyStream;

}

/**
 * Transforms a single path from the original
 * into a proper composite path.
 *
 * @param {object} mount
 * @param {string} path
 * @returns {string}
 */
function transformPath( mount, path ) {

	// Prefix is optional, so we check for it
	if( mount.prefix !== undefined ) {
		var pfLen = mount.prefix.length;
		if( path.substr( 0, pfLen ) == mount.prefix ) {
			path = path.substr( pfLen );
		}
	}

	// All mounts should have a root
	path = mount.root + path;

	// Done
	return path;

}
