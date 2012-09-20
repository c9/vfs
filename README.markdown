# VFS - Virtual File System

**This repo is being broken up into several smaller repos.  For example, see [vfs-local](https://github.com/c9/vfs-local), [vfs-socket](https://github.com/c9/vfs-socket) and [vfs-http-adapter](https://github.com/c9/vfs-http-adapter).**

This module is a vfs implementation for node.js.  Originally it was created for
our internal needs at Cloud9IDE.  Eventually it grew to be generally useful so
we're releasing it here as a general purpose vfs system.

The basic use case for this system is to expose a common http friendly, streaming,
filesystem interface.  It's doesn't assume http and can be used in other contexts,
but it does provide support for http Range requests, ETag based conditional queries,
HEAD requests, and file streaming for reading and writing.  Also it provides
streaming directory listing using weak ETags.

Also included is a connect/stack middleware module that allows mounting these vfs
instances and exposing them with a simple RESTful API.

# HTTP RESTful Interface

See the docs in the http-adapter for specifics.

<https://github.com/c9/vfs-http-adapter>

# JavaScript Interface

The various vfs implementations all follow the same JavaScript interface so that
they are interchangable.

## setup(options)

At the top of the module (often the module itself) is a setup function.  This
takes a single options object as configuration and returns a vfs instance.

Available options vary by module.  See the indivual modules for specifics.

Within a vfs, paths are relative to that vfs and files outside that tree cannot
be accessed.

All functions have the same signature `(path, options, callback(err, meta){})`.

`path` is always the path to the resource in question.  It's a virtual path
relative to the vfs instance.

## vfs.readfile(path, options, callback)

Read a file and stream it's contents.

`options` can include:

 - options.etag - the browser sent an If-None-Match header with etag
 - options.head - the request was a HEAD request
 - options.range - the request had a Range header, this object can have "start", "end" and/or "etag".

`meta` in the response can include:

 - meta.notModified - truthy if the server should send 304 (etag matched)
 - meta.rangeNotSatisfiable - truthy if the server should send 416
 - meta.partialContent - object if server should send 206 and contains "start", "end", and "size" needed for the "Content-Range" header.
 - meta.mime - the mime type of the file
 - meta.size - the size of the file
 - meta.etag - the etag of the file (embeds inode, size and mtime)
 - meta.stream - a readable stream if the response should have a body.

## vfs.readdir(path, options, callback)

Read a directory and get a listing of it's contents as JSON.  Note the stream is
a data stream (already JSON serialized), not an object stream.

`options` can include:

 - options.etag - the browser sent an If-None-Match header with etag
 - options.head - the request was a HEAD request

`meta` in the response can include:

 - meta.notModified - truthy if the server should send 304 (etag matched)
 - meta.etag - The weak etag of the directory (embeds inode, size and mtime)
 - meta.mime - The mime of the directory "inode/directory"
 - meta.stream - The json stream (unless options.head was truthy)

The format of the stream is a JSON array with an object for each entry in the
directory.  Entries contain:

 - name: the filename
 - path: the path relative to the vfs root
 - href: a full href to the resource (useful for the jsonview plugin to enable hyperlinking)
 - mime: the mime type of the file, this includes directories, symlinks, sockets, etc..
 - access: An integer bitfield showing the access permissions of the vfs. (4 - read, 2 - write, 1 - execute/search)
 - size: The size of the file as reported by stat
 - etag: The etag of this file or directory
 - link: (optional) The data contents of a symlink if the entry is a symlink.

## vfs.stat(path, options, callback)

Returns the file system attributes of a directory or a file and returns it
using the same format as the `readdir` command.

`meta` in the response can include:

 - meta.etag - The weak etag of the directory (embeds inode, size and mtime)
 - meta.mime - The mime of the directory "inode/directory"
 - name: the filename
 - path: the path relative to the vfs root
 - href: a full href to the resource (useful for the jsonview plugin to enable hyperlinking)
 - access: An integer bitfield showing the access permissions of the vfs. (4 - read, 2 - write, 1 - execute/search)
 - size: The size of the file as reported by stat
 - link: (optional) The data contents of a symlink if the entry is a symlink.

## vfs.mkfile(path, options, callback)

Saves a file stream to the vfs.  Always first creates a tmp file and then renames
for atomic writes.

There are no `options` for this function.

`meta` in the response can include:

 - meta.stream - a writable stream to the filesystem.
 - meta.tmpPath - the actual filepath of the tmpfile


## vfs.mkdir(path, options, callback)

Create a directory.

There are no `options` for this function.

`meta` in the response is empty.

## vfs.rmfile(path, options, callback)

Remove a file

There are no `options` for this function.

`meta` in the response is empty.

## vfs.rmdir(path, options, callback)

Remove a directory

`options` can include:

 - options.recursive - (optional, default is `false`) whether to delete everything within this directory.

`meta` in the response is empty.

## vfs.rename(path, options, callback)

Rename a file or directory

`options` can include:

 - options.from - the file we want to rename.

`meta` in the response is empty.

## vfs.copy(path, options, callback)

Copy a file

`options` can include:

 - options.from - the file we want to copy from.

`meta` in the response is empty.

## vfs.symlink(path, options, callback)

Create a symlink

`options` can include:

 - options.target - The data contents of the symlink

`meta` in the response is empty.



