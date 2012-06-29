exports.add = function (a, b, callback) {
	callback(null, a + b);
};

exports.multiply = function (a, b, callback) {
	callback(null, a * b);
};