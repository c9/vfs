# VFS - Virtual File System

This module is a vfs implementation for node.js.  Originally it was created for
our internal needs at Cloud9IDE, but grew to be generally useful.

The basic use case for this system is to expose a common http friendly, streaming,
filesystem interface.  It's doesn't assume http and can be used in other contexts,
but it does provide support for http Range requests, ETag based conditional queries,
HEAD requests, and file streaming for reading and writing.  Also it provides
streaming directory listing using weak ETags.

Also included is a connect/stack middleware module that allows mounting these vfs
instances and exposing them with a simple RESTful API.

# The REST interface.

When using the http adaptor, your server will expose the following interface:

## `HEAD /any/path`

All HEAD requests are converted to GET requests internally and act identical, 
except there is an internal flag in the vfs layer telling it to not stream the body.

## `GET /path/to/file`

Serve a file to the client as a stream.  Supports etags and range requests.

## `GET /directory/path/with/slash/`

Serve a directory listing as a JSON document.

This is served as a streaming json document with a weak etag (since the order 
of the entries is not defined.)  It supports conditional GET requests
   
The format is a JSON array with an object for each entry in the directory.  Entries contain:

 - name: the filename
 - path: the path relative to the vfs root
 - href: a full href to the resource (useful for the jsonview plugin to enable hyperlinking)
 - mime: the mime type of the file, this includes directories, symlinks, sockets, etc..
 - access: An integer bitfield showing the access permissions of the vfs. (4 - read, 2 - write, 1 - execute/search)
 - size: The size of the file as reported by stat
 - etag: The etag of this file or directory
 - link: (optional) The data contents of a symlink if the entry is a symlink.

## `PUT /path/to/file`

Recieve a file from the client and save it to the vfs.  The file body is streamed.

## `PUT /directory/path/with/slash/`

Create a directory

## `DELETE /path/to/file`

Delete a file.

## `DELETE /directory/path/with/slash/`

Delete a directory (not recursive)


## `POST /path/to/target`

POST is used for various adhoc commands that are useful but don't fit well into
the RESTful paradigm.  The client sends a JSON body containing the request information.

Currently this includes:

 - {"renameFrom": from} - rename a file from `from` to `target`.
 - {"copyFrom": from} - copy a file from `from` to `target`.
 - {"linkTo": data} - create a symlink at `target` containing `data`.

