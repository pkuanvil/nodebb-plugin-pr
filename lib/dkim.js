'use strict';

const { open } = require.main.require('node:fs/promises');
const { dkimVerify } = require('mailauth/lib/dkim/verify');
const { string_remove_starts_with } = require('./utility');

const Dkim = {};

// internal method, will cause ARBITARY file read
Dkim.getResult = async function (sourceFile) {
	const fd = await open(sourceFile);
	const stream = fd.createReadStream();
	const result = await dkimVerify(stream);
	return result;
};

Dkim.getTo = function (dkimResult) {
	function verify1(res0) {
		const { status, signingDomain, signingHeaders } = res0;
		if (status.result !== 'pass' || !signingHeaders) {
			return {};
		}
		const { keys: keys_str, headers } = signingHeaders;
		if (!keys_str || !headers) {
			return {};
		}
		const keys = keys_str.split(': ');
		for (let i = 0; i < keys.length; i++) {
			if (keys[i].startsWith('To') && headers[i].startsWith('To: ')) {
				return {
					signingDomain,
					to: string_remove_starts_with(headers[i], 'To: '),
				};
			}
		}
		return {};
	}
	const return_result = [];
	for (const res of dkimResult.results) {
		return_result.push(verify1(res));
	}
	return return_result;
};

module.exports = Dkim;
