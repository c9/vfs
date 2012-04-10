# Local Filesystem VFS

The local filesystem vfs is an implementation of the vfs interface that provides
access to the local filesystem (local to the node process that requires it).  In
addition to providing basic filesystem access, it provides a sandbox to
run a vfs as a virtual user.  Your process can continue to run as root, but each
vfs instance will restrict itself to what that user is allowed to do.  Thus it's
possible to implement a multi-tennent filesystem using a single process.

## setup(fsOptions)

The module itself is a setup function that returns a vfs instance.

`fsOptions` can include:

 - fsOptions.uid - restricts access as if this user was running as
 - fsOptions.gid   this uid/gid, create files as this user.
 - fsOptions.umask - default umask for creating files
 - fsOptions.root - root path to mount, this needs to be realpath'ed or it won't work.
 - fsOptions.skipSearchCheck - Skip the folder execute/search permission check on file open.
 - fsOptions.httpRoot - used for generating links in directory listing.  It's where this fs is mounted over http.
