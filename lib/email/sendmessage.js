'use strict';

const crypto = require.main.require('crypto');
const buffer = require.main.require('buffer');
const { Buffer } = buffer;
const meta = require.main.require('./src/meta');
const db = require.main.require('./src/database');
const helpers = require.main.require('./src/controllers/helpers');

const { catchApiException } = require('../utility/controllerhelper');
const { pr_lock, pr_unlock } = require('../utility/misc');
const { getType } = require('./usertype');

const SendMessage = {};

async function internal_email_add({ from, regreq }) {
	// Check type
	const type = getType(from);
	if (!type) {
		return [400, Error(`Email ${from} is not allowed to register`)];
	}
	// Check whether email address or register request is already used
	if (await db.isSetMember('pr:emailused', from)) {
		return [401, Error(`Email Already used: ${from}`)];
	}
	if (await db.isSetMember('pr:regreq', regreq)) {
		return [400, Error(`This register request: ${regreq} is already submitted`)];
	}
	// Try acquire lock
	try {
		await pr_lock('email:', from);
	} catch (e) {
		return [401, Error(`Email Already used: ${from}`)];
	}
	try {
		await pr_lock('regreq:', regreq, '');
	} catch (e) {
		await pr_unlock('email:', from);
		return [400, Error(`This register request: ${regreq} is already submitted`)];
	}
	await db.setAdd('pr:emailused', from);
	await db.setAdd('pr:regreq', regreq);
	await db.sortedSetAdd(`pr:regreq:types`, type, regreq);
	await pr_unlock('regreq:', regreq);
	await pr_unlock('email:', from);
	// Successful return
	return [200, { email_used: from }];
}

function tryDecrypt(body, pr_sk_base64) {
	const PREFIX = 'USeRnaMe\n';
	let pr_sk;
	try {
		const pr_sk_str = Buffer.from(pr_sk_base64, 'base64');
		pr_sk = crypto.createPrivateKey(pr_sk_str);
		pr_sk.oaepHash = 'sha256';
		// Buffer.from(string) returns empty buffer instead of throwing on invalid base64 encodings
	} catch (e) {
		// This should only comes from crypto.createPrivateKey(), which means pr_sk_base64 is invalid
		console.log(e);
		return { decres: '5xx', regreq: null };
	}
	try {
		const regreq_enc_buf = Buffer.from(body, 'base64');
		const regreq_dec_buf = crypto.privateDecrypt(pr_sk, regreq_enc_buf);
		let regreq = regreq_dec_buf.toString();
		if (!regreq.startsWith(PREFIX)) {
			return { decres: '4xx', regreq: null };
		}
		regreq = regreq.substring(PREFIX.length);
		return { decres: '2xx', regreq: regreq };
	} catch (e) {
		// Decryption error
		return { decres: '4xx', regreq: null };
	}
}

function tryDecryptAll(arr, pr_sk_base64) {
	let res = {};
	for (const body of arr) {
		res = tryDecrypt(body, pr_sk_base64);
		if (res.decres !== '4xx') {
			break;
		}
	}
	return res;
}

async function email_add(req, res) {
	const { register_sk: pr_sk_base64 } = await meta.settings.get('pr');
	const { from, plain, subject } = req.body;
	const { decres, regreq } = tryDecryptAll([plain, subject], pr_sk_base64);
	if (decres === '5xx') {
		return helpers.formatApiResponse(502, res, null);
	} else if (decres !== '2xx') {
		return helpers.formatApiResponse(403, res, Error('Invalid register request'));
	}
	const [status, result] = await internal_email_add({ res, from, regreq });
	return helpers.formatApiResponse(status, res, result);
}

SendMessage.email_add = catchApiException(email_add);

async function email_postmark(req, res) {
	// Only return 200 for postmark, since postmark will retry for everything not 200
	const { register_sk: pr_sk_base64 } = await meta.settings.get('pr');
	const { Headers, From, Subject, TextBody } = req.body;
	if (!Headers || !From || !Subject || !TextBody) {
		return helpers.formatApiResponse(200, res, { status: 400, msg: 'Invalid Postmark Format' });
	}
	// Check SPF result by postmark
	const spf_headers = Headers.filter(item => item.Name === 'Received-SPF');
	if (spf_headers.length === 0) {
		return helpers.formatApiResponse(200, res, { status: 400, msg: 'No SPF result' });
	}
	const spf_result = spf_headers[0].Value || '';
	// Ignore softfail for now
	if (!spf_result.match(/^(pass|neutral|softfail)/i)) {
		return helpers.formatApiResponse(200, res, { status: 400, msg: 'SPF failed' });
	}
	const { decres, regreq } = tryDecryptAll([Subject, TextBody], pr_sk_base64);
	if (decres === '5xx') {
		return helpers.formatApiResponse(200, res, { status: 500, msg: 'Cannot get register privatekey' });
	} else if (decres !== '2xx') {
		return helpers.formatApiResponse(200, res, { status: 400, msg: 'Cannot decrypt register request' });
	}
	const [status, result] = await internal_email_add({ from: From, regreq });
	return helpers.formatApiResponse(200, res, {
		status,
		msg: result instanceof Error ?
			result.toString() :
			undefined,
		result: result instanceof Error ?
			undefined :
			result,
	});
}

SendMessage.email_postmark = catchApiException(email_postmark);

module.exports = SendMessage;
