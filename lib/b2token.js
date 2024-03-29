'use strict';

const { catchApiException } = require('./utility/controllerhelper');

const _ = require.main.require('lodash');
const db = require.main.require('./src/database');
const user = require.main.require('./src/user');
const { generateUUID } = require.main.require('./src/utils');
const controllerHelpers = require.main.require('./src/controllers/helpers');

const b2token = {};

// TODO: 2FA

b2token.getOrCreateB2Token = async function (uid) {
	let token = await db.getObjectField(`pr:b2token:uid:${uid}`, 'token');
	if (!token) {
		token = generateUUID();
		await db.setObjectField(`pr:b2token:uid:${uid}`, 'token', token);
	}
	return token;
};

b2token.removeB2Token = async function (uid) {
	await db.deleteObjectField(`pr:b2token:uid:${uid}`, 'token');
};

b2token.listB2Keys = async function (uid) {
	const keys = await db.getObjectField(`pr:b2token:uid:${uid}`, 'b2keys') || [];
	return keys;
};

b2token.appendB2Keys = async function (uid, keys) {
	const old_b2keys = await b2token.listB2Keys(uid);
	let new_b2keys = old_b2keys.concat(keys);
	new_b2keys = _.uniqBy(new_b2keys, _.property('keyID'));
	await db.setObjectField(`pr:b2token:uid:${uid}`, 'b2keys', new_b2keys);
};

b2token.removeB2Keys = async function (uid, keys) {
	const old_b2keys = await b2token.listB2Keys(uid);
	const new_b2keys = _.differenceBy(old_b2keys, keys, _.property('keyID'));
	await db.setObjectField(`pr:b2token:uid:${uid}`, 'b2keys', new_b2keys);
};

b2token.getDefaultB2KeyID = async function (uid) {
	return await db.getObjectField(`pr:b2token:uid:${uid}`, 'defaultb2keyid');
};

b2token.setDefaultB2KeyID = async function (uid, keyID) {
	await db.setObjectField(`pr:b2token:uid:${uid}`, 'defaultb2keyid', keyID);
};

b2token.registerPrefix = async function (uid, prefix) {
	const prefix_count = await db.incrObjectField(`pr:p2token:prefix:${prefix}`, 'count');
	if (prefix_count !== 1) {
		const owner_uid = await db.getObjectField(`pr:p2token:prefix:${prefix}`, 'uid');
		if (owner_uid === uid) {
			return {
				success: true,
				isOwner: true,
			};
		}
		return {
			success: false,
			message: 'isRegistered',
		};
	}
	const uid_count = await db.incrObjectField(`pr:p2token:uid:${uid}`, 'count');
	// Currently hardcode limit
	if (uid_count > 1000) {
		return {
			success: false,
			message: 'exceedLimit',
		};
	}
	await db.setObject(`pr:p2token:prefix:${prefix}`, { uid });
	return {
		success: true,
		prefix,
	};
};

b2token.handler = catchApiException(async (req, res) => {
	// req.uid is the uid verified by NodeBB
	let { uid } = req;
	let token;
	if (uid <= 0) {
		const { uid: uid_body, token: token_body } = req.body;
		const token_result = await b2token.getOrCreateB2Token(uid_body);
		if (token_result !== token_body) {
			return controllerHelpers.formatApiResponse(403, res, Error('Not logged In'));
		}
		uid = uid_body;
		token = token_body;
	} else {
		token = await b2token.getOrCreateB2Token(uid);
	}
	const userdata = await user.getUserFields(uid, ['uid', 'username']);
	const defaultb2keyid = await b2token.getDefaultB2KeyID(uid);
	const { action } = req.body;
	if (action === 'remove') {
		await b2token.removeB2Token(uid);
		return controllerHelpers.formatApiResponse(200, res, {
			userdata,
			token,
			defaultb2keyid,
		});
	} else if (action === 'listb2keys') {
		const keys = await b2token.listB2Keys(uid);
		return controllerHelpers.formatApiResponse(200, res, {
			userdata,
			token,
			keys,
			defaultb2keyid,
		});
	} else if (action === 'appendb2keys') {
		const { keys: keys_body } = req.body;
		await b2token.appendB2Keys(uid, keys_body);
		const keys = await b2token.listB2Keys(uid);
		return controllerHelpers.formatApiResponse(200, res, {
			userdata,
			token,
			keys,
			defaultb2keyid,
		});
	} else if (action === 'removeb2keys') {
		const { keys: keys_body } = req.body;
		await b2token.removeB2Keys(uid, keys_body);
		const keys = await b2token.listB2Keys(uid);
		return controllerHelpers.formatApiResponse(200, res, {
			userdata,
			token,
			keys,
			defaultb2keyid,
		});
	} else if (action === 'setdefaultb2keyid') {
		const { keyID } = req.body;
		if (!keyID) {
			return controllerHelpers.formatApiResponse(400, res, Error('No KeyID'));
		}
		await b2token.setDefaultB2KeyID(uid, keyID);
		return controllerHelpers.formatApiResponse(200, res, {
			userdata,
			token,
			defaultb2keyid: keyID,
		});
	} else if (action === 'registerprefix') {
		const { prefix } = req.body;
		if (typeof prefix !== 'string') {
			return controllerHelpers.formatApiResponse(400, res, Error('Parameter "prefix" is not string'));
		}
		const result = await b2token.registerPrefix(uid, prefix);
		if (result.success) {
			return controllerHelpers.formatApiResponse(200, res, result);
		}
		return controllerHelpers.formatApiResponse(403, res, Error(result.message));
	}
	return controllerHelpers.formatApiResponse(400, res, Error(`Invalid B2Token action ${action}`));
});

module.exports = b2token;
