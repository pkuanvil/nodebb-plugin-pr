'use strict';

const db = require.main.require('./src/database');
const PLUGIN_JSON = require('../plugin.json');

const winston = require.main.require('winston');
const NodeUtils = require.main.require('util');

const Utility = {};

Utility.string_remove_starts_with = function (str, prefix) {
	const colon_index = str.indexOf(prefix);
	if (colon_index !== -1) {
		return str.substring(colon_index + prefix.length);
	}
	return str;
};

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

Utility.injectHookName = function (PLUGIN_MODULE) {
	const methodNameList = PLUGIN_JSON.hooks.map(v => v.method);
	for (const method of methodNameList) {
		const names = method.split('.');
		let ref = PLUGIN_MODULE;
		for (let i = 0; i < names.length - 1; i++) {
			const name = names[i];
			if (typeof ref[name] !== 'object') {
				ref[name] = {};
			}
			ref = ref[name];
		}
	}
};

Utility.debug = winston.verbose;

Utility.inspect = function (data) {
	Utility.debug(NodeUtils.inspect(data, { color: true, depth: 5 }));
};

module.exports = Utility;
