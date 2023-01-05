'use strict';

const db = require.main.require('./src/database');

const Utility = {};

// prefix must not exceed 15 chars
const PREFIX_MAX_LEN = 15;
Utility.pr_lock = async function (prefix, value, error) {
	const count = await db.incrObjectField('pr:locks', prefix.padStart(PREFIX_MAX_LEN, '0') + value);
	if (count > 1) {
		throw new Error(error);
	}
};

Utility.pr_unlock = async function (prefix, value) {
	await db.deleteObjectField('pr:locks', prefix.padStart(PREFIX_MAX_LEN, '0') + value);
};


module.exports = Utility;
