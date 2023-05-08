'use strict';

const winston = require.main.require('winston');
const db = require.main.require('./src/database');

const Utility = require('./utility/misc');

const { pr_lock, pr_unlock } = Utility;

const Register = {};

Register.check = async (payload) => {
	Utility.debug('Register check');
	Utility.inspect(payload.userData);
	const { noscript, uuid, username, password } = payload.userData;
	if (uuid) {
		const uuidStatus = await db.getObject(`pr:dkim:uuid:${uuid}`);
		if (!uuidStatus || !uuidStatus.status) {
			throw new Error('Invalid register UUID');
		}
		if (uuidStatus.status === 'success') {
			// Do nothing
		} else if (uuidStatus.status === 'pending') {
			throw new Error('Your DKIM register request is waiting for admin approval. Please try again later');
		} else if (uuidStatus.status === 'done') {
			throw new Error('Your DKIM register request has already been completed.');
		} else if (uuidStatus.status === 'rejected') {
			throw new Error(`Your DKIM register request is rejected, reason: ${uuidStatus.reason}`);
		} else {
			throw new Error('Internal Server Error');
		}
	} else {
		if (noscript === 'true') {
			throw new Error('Registeration requires JavaScript.');
		}
		const regreq = `${username}\n${password}`;
		if (!await db.isSetMember('pr:regreq', regreq)) {
			throw new Error('The Server has not received your register request.');
		} else if (await db.isSetMember('pr:regreq_done', regreq)) {
			throw new Error('This register request has already been completed.');
		}
	}
};

Register.abort = async (payload) => {
	Utility.debug('Regiser abort');
	Utility.inspect(payload.req.session);
	try {
		const { uuid, username, password } = payload.req.session.registration;
		if (uuid) {
			await db.setObjectField(`pr:dkim:uuid:${uuid}`, 'status', 'success');
		} else {
			const regreq = `${username}\n${password}`;
			await db.setRemove('pr:regreq_done', regreq);
		}
	} catch (e) {
		winston.error(e.stack);
	}
};

Register.interstitial = async (payload) => {
	Utility.debug('Register interstitial');
	Utility.inspect(payload.userData);
	const { req, userData } = payload;
	if (req.method !== 'POST') {
		return payload;
	}
	const { uuid, username, password } = userData;
	// Don't activate when user POST at first page /register, when user has not yet read the "complete" page warnings
	// Use route path instead of absolute path, because website can be prefixed
	if (req.route.path === '/register/complete' && !userData.pr_interstitial_done) {
		// Fix: also add check at interstitial
		if (uuid) {
			await pr_lock('uuid:', uuid, `Cannot lock uuid ${uuid}.`);
			const status = await db.getObjectField(`pr:dkim:uuid:${uuid}`, 'status');
			if (status !== 'success') {
				await pr_unlock('uuid:', uuid);
				throw new Error(`Your DKIM register request has invalid status: ${status}.`);
			}
			await db.setObjectField(`pr:dkim:uuid:${uuid}`, 'status', 'done');
			userData.pr_interstitial_done = true;
			await pr_unlock('uuid:', uuid);
		} else {
			const regreq = `${username}\n${password}`;
			await pr_lock('regreq:', regreq, `Cannot lock regreq ${regreq}.`);
			if (await db.isSetMember('pr:regreq_done', regreq)) {
				await pr_unlock('regreq:', regreq);
				throw new Error('This register request has already been completed.');
			}
			await db.setAdd('pr:regreq_done', regreq);
			userData.pr_interstitial_done = true;
			await pr_unlock('regreq:', regreq);
		}
	}
	return payload;
};

module.exports = Register;