'use strict';

/* eslint-disable no-continue */

const controllerHelpers = require.main.require('./src/controllers/helpers');
const meta = require.main.require('./src/meta');
const { generateUUID } = require.main.require('./src/utils');
const db = require.main.require('./src/database');

const fs = require.main.require('fs/promises');
const _ = require.main.require('lodash');
const nconf = require.main.require('nconf');
const RAW_EMAIL_SAVE_DIR = nconf.get('dkim:rawEmailSaveDir') || `${nconf.get('upload_path')}/dkim`;

const { dkimVerify } = require('mailauth/lib/dkim/verify');
const { string_remove_starts_with, pr_lock, pr_unlock, inspect } = require('../utility/misc');
const { deleteTempFile, deleteTempFileArray } = require('../utility/multiparty');
const { errorWithResponse } = require('../utility/controllerhelper');

const Dkim = {};

Dkim.getTo = function (dkimResult) {
	function verify1(res0) {
		const { status, signingDomain, signingHeaders } = res0;
		if (!signingHeaders) {
			return {};
		}
		const { keys: keys_str, headers } = signingHeaders;
		if (!keys_str || !headers) {
			return {};
		}
		const keys = keys_str.split(': ');
		const { result, comment } = status;
		for (let i = 0; i < keys.length; i++) {
			if (keys[i].startsWith('To') && headers[i].startsWith('To: ')) {
				return {
					result,
					comment,
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

Dkim.uploadGET = async function (req, res) {
	res.render('pr_dkim_upload');
};

// Save file need to be awaited before delete
async function saveRawEmail(uuid, status, tempPath) {
	await fs.copyFile(tempPath, `${RAW_EMAIL_SAVE_DIR}/${status}/${uuid}`);
}

function emailGetRaw(emailfull) {
	const atPosition = emailfull.indexOf('@');
	const lessPosition = emailfull.lastIndexOf('<', atPosition - 1);
	if (lessPosition === -1) {
		return emailfull;
	}
	const largePosition = emailfull.indexOf('>', atPosition + 1);
	return emailfull.substring(lessPosition + 1, largePosition);
}

function emailGetDomain(emailfull) {
	const emailRaw = emailGetRaw(emailfull);
	return string_remove_starts_with(emailRaw, '@');
}

async function dkimVerify_File(sourceFile) {
	const fd = await fs.open(sourceFile);
	const stream = fd.createReadStream();
	const result = await dkimVerify(stream);
	return result;
}

async function uploadPOST(req, res) {
	const tempPath = req.files.file.path;
	let { register_helo_domains, register_from_domains } = await meta.settings.get('pr');
	register_helo_domains = register_helo_domains.split(';');
	register_from_domains = register_from_domains.split(';');
	const dkimResult = await dkimVerify_File(tempPath);
	const toArray = Dkim.getTo(dkimResult);
	let emailaddress;
	let status = 'failed';
	let find_to_signature = false;
	let find_dkim_pass = false;
	let failReason = [];
	inspect(toArray);
	for (const toObject of toArray) {
		// {} and [] evaluates to true, not false...
		if (!toObject.result) {
			continue;
		}
		find_to_signature = true;
		const { signingDomain, to, result, comment } = toObject;
		if (result !== 'pass') {
			failReason.push(`DKIM signature verify failed for signingDomain ${signingDomain} and address ${to}, reason: ${comment}`);
			continue;
		}
		find_dkim_pass = true;
		// Don't allow bulk deliver email
		const atSymbolCount = (to.match(/@/g) || []).length;
		if (atSymbolCount !== 1) {
			failReason.push('group email not allowed');
			continue;
		}
		const domain = emailGetDomain(to);
		if (_.includes(register_from_domains, domain)) {
			emailaddress = emailGetRaw(to);
			if (_.includes(register_helo_domains, signingDomain)) {
				status = 'success';
				break;
			} else {
				status = 'pending';
			}
		} else {
			failReason.push(`At least one DKIM 'To: ' signature found, but its email domain: ${domain} is not authorized to register`);
		}
	}
	if (!find_to_signature) {
		status = 'failed';
		failReason = ['This email doesn\'t have DKIM \'To: \' signature. Please retry with another one.'];
	} else if (!emailaddress) {
		status = 'failed';
		// No need to add additional failReason, should already be set above
	}
	// Immediately lock email address if success
	if (status === 'success') {
		try {
			await pr_lock('email:', emailaddress);
		} catch (e) {
			return errorWithResponse(500, res, Error(`Conflicting register request for ${emailaddress} found. Please try again.`), { toArray });
		}
		if (await db.isSetMember('pr:emailused', emailaddress)) {
			status = 'failed';
			failReason.push(`This email address is already used: ${emailaddress}`);
		} else {
			await db.setAdd('pr:emailused', emailaddress);
		}
		await pr_unlock('email:', emailaddress);
	} else if (status === 'pending' && await db.isSetMember('pr:emailused', emailaddress)) {
		status = 'failed';
		failReason.push(`This email address is already used: ${emailaddress}`);
	}
	// Save raw email after adjusting status
	let uuid = 'bad-dkim-signature';
	if (find_dkim_pass) {
		uuid = generateUUID();
		await saveRawEmail(uuid, status, tempPath);
	}
	if (status === 'success' || status === 'pending') {
		await db.setObject(`pr:dkim:uuid:${uuid}`, {
			status,
			emailaddress,
			toArray,
			reason: '',
		});
	}
	if (status === 'failed') {
		return errorWithResponse(403, res, Error(`Request UUID=${uuid} failed, reason: ${failReason.join('; ')}`), { toArray });
	}
	const next = `${nconf.get('relative_path')}/pr_dkim_register?&uuid=${uuid}`;
	if (req.body.noscript === 'true') {
		res.redirect(next);
		return;
	}
	res.json({ next });
}

Dkim.uploadPOST = async function (req, res) {
	if (!req.header('Content-Type').startsWith('multipart/form-data')) {
		return controllerHelpers.formatApiResponse(403, res, Error(`Invalid HTTP header "Content-Type: ${req.header('Content-Type')}"`));
	}
	inspect(req.files);
	if (typeof req.files.files !== 'undefined') {
		deleteTempFileArray(req.files.files);
		return controllerHelpers.formatApiResponse(403, res, Error('Multiple files are not accepted'));
	}
	if (typeof req.files.file !== 'object') {
		return controllerHelpers.formatApiResponse(400, res, Error('Weird req.files.file'));
	}
	if (req.files.file.size === 0) {
		// ENOENT error will happen if merged to normal flow below. Just fail fast
		return controllerHelpers.formatApiResponse(400, res, Error('Empty file received'));
	}
	try {
		await uploadPOST(req, res);
	} catch (e) {
		controllerHelpers.formatApiResponse(500, res);
		console.error(e);
		console.trace();
	} finally {
		deleteTempFile(req.files.file);
	}
};

Dkim.manageUUID = async function (req, res) {
	const payload = req.body;
	const { uuid } = req.params;
	const uuidStatus = await db.getObject(`pr:dkim:uuid:${uuid}`);
	if (!uuidStatus) {
		return controllerHelpers.formatApiResponse(404, res, Error(`Cannot find UUID: ${uuid}`));
	}
	// fast return if already success
	if (uuidStatus.status === 'success') {
		return controllerHelpers.formatApiResponse(200, res, uuidStatus);
	}
	if (payload.status === 'success') {
		const { emailaddress } = uuidStatus;
		if (!emailaddress) {
			return controllerHelpers.formatApiResponse(404, res, Error(`Cannot find emailaddress for UUID: ${uuid}`));
		}
		try {
			await pr_lock('email:', emailaddress);
		} catch (e) {
			return controllerHelpers.formatApiResponse(500, res, Error(`Conflicting register request for ${emailaddress} found. Please try again.`));
		}
		if (await db.isSetMember('pr:emailused', emailaddress)) {
			uuidStatus.status = 'rejected';
			uuidStatus.reason = `This email address is already used: ${emailaddress}`;
			await db.setObject(`pr:dkim:uuid:${uuid}`, uuidStatus);
		} else {
			await db.setAdd('pr:emailused', emailaddress);
			uuidStatus.status = 'success';
			await db.setObjectField(`pr:dkim:uuid:${uuid}`, 'status', 'success');
		}
		await pr_unlock('email:', emailaddress);
	} else if (payload.status === 'rejected') {
		uuidStatus.status = 'rejected';
		uuidStatus.reason = payload.reason || '';
		await db.setObject(`pr:dkim:uuid:${uuid}`, uuidStatus);
	}
	controllerHelpers.formatApiResponse(200, res, uuidStatus);
};

module.exports = Dkim;