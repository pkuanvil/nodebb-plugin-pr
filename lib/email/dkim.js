'use strict';

/* eslint-disable no-continue */

const controllerHelpers = require.main.require('./src/controllers/helpers');
const meta = require.main.require('./src/meta');
const { generateUUID } = require.main.require('./src/utils');
const db = require.main.require('./src/database');

const dns = require.main.require('dns/promises');
const fs = require.main.require('fs/promises');
const _ = require.main.require('lodash');
const nconf = require.main.require('nconf');
const RAW_EMAIL_SAVE_DIR = nconf.get('dkim:rawEmailSaveDir') || `${nconf.get('upload_path')}/dkim`;

const { dkimVerify } = require('mailauth/lib/dkim/verify');
const { string_remove_starts_with, pr_lock, pr_unlock, inspect } = require('../utility/misc');
const { deleteTempFile, deleteTempFileArray } = require('../utility/multiparty');
const { errorWithResponse, catchApiException } = require('../utility/controllerhelper');
const { emailGetRaw, emailGetDomain } = require('./utility');
const { getType: EmailGetType } = require('./usertype');

const Dkim = {};

Dkim.getSigningDomain = function (dkimResult) {
	function verify1(res0) {
		// Check DKIM headers
		const { status, signingDomain, signingHeaders } = res0;
		if (!signingHeaders) {
			return {};
		}
		const { keys: keys_str, headers } = signingHeaders;
		if (!keys_str || !headers) {
			return {};
		}
		// DKIM headers found. Now check whether 'To' is a DKIM signed header.
		// Note that even if a 'To' is not found, we still returns other result for statistics
		const keys = keys_str.split(': ');
		const { result, comment } = status;
		let to = '';
		for (let i = 0; i < keys.length; i++) {
			if (keys[i].startsWith('To') && headers[i].startsWith('To: ')) {
				to = string_remove_starts_with(headers[i], 'To: ');
				break;
			}
		}
		return {
			result,
			comment,
			signingDomain,
			to,
		};
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

async function dkimVerify_File(sourceFile) {
	const fd = await fs.open(sourceFile);
	const stream = fd.createReadStream();
	const result = await dkimVerify(stream);
	return result;
}

function isEmptyToObject(toObject) {
	return !toObject.result;
}

function isValidToObject(toObject) {
	return toObject.to;
}

function statDKIMResult({ toArray, status, find_to_signature, find_dkim_pass }) {
	// Some result may be empty
	toArray = _.filter(toArray, toObject => !isEmptyToObject(toObject));
	const signingDomainArray = toArray.map(toObject => toObject.signingDomain);
	let signersString = signingDomainArray.sort().join('--');
	// Don't use dot in object field
	signersString = signersString.replaceAll('.', '_-');

	const Bulk = toArray.map((toObject) => {
		const { signingDomain, result, comment } = toObject;
		const key = `pr:dkim:stat:signingdomain:${signingDomain}`;
		const key_object = {};
		key_object.count = 1;
		key_object[`dkim_result--${result}`] = 1;
		key_object[status] = 1;
		// Comment can be empty or even undefined
		if (comment) {
			key_object[`comment--${comment}`] = 1;
		}
		key_object[`signer--${signersString.replaceAll('.', '_-')}`] = 1;
		key_object.find_to_signature = find_to_signature ? 1 : 0;
		key_object.find_dkim_pass = find_dkim_pass ? 1 : 0;
		return [key, key_object];
	});

	return Promise.all([
		db.setAdd('pr:dkim:stat:signingdomainAll', signingDomainArray),
		db.incrObjectFieldByBulk(Bulk),
	]);
}

async function dnswl(domain) {
	let addr = [];
	try {
		addr = await dns.resolve(`${domain}.dwl.dnswl.org`);
	} catch (e) {
		// We don't care
	}
	let result = '';
	if (addr.length > 0) {
		result = addr[0];
		if (result.endsWith('.255')) {
			result = '';
		}
	}
	return result;
}

async function uploadPOST(req, res) {
	const tempPath = req.files.file.path;
	let { register_helo_domains } = await meta.settings.get('pr');
	register_helo_domains = register_helo_domains.split(';');
	const dkimResult = await dkimVerify_File(tempPath);
	const toArray = Dkim.getSigningDomain(dkimResult);
	let emailaddress;
	let status = 'failed';
	let find_to_signature = false;
	let find_dkim_pass = false;
	let failReason = [];
	inspect(toArray);
	for (const toObject of toArray) {
		// {} and [] evaluates to true, not false...
		if (!isValidToObject(toObject)) {
			continue;
		}
		const { signingDomain, to, result, comment } = toObject;
		find_to_signature = true;
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
		if (EmailGetType(domain)) {
			emailaddress = emailGetRaw(to);
			if (_.includes(register_helo_domains, signingDomain)) {
				status = 'success';
				break;
			// eslint-disable-next-line no-await-in-loop
			} else if (await dnswl(signingDomain)) {
				status = 'success';
				break;
			} else {
				status = 'pending';
			}
		} else {
			failReason.push(`At least one DKIM 'To: ' signature found, but its email domain: ${domain} is not authorized to register`);
		}
	}
	// Stat result before adjusting status
	await statDKIMResult({ toArray, status, find_to_signature, find_dkim_pass });
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

async function manageUUID(req, res) {
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
}

Dkim.manageUUID = catchApiException(manageUUID);

module.exports = Dkim;
