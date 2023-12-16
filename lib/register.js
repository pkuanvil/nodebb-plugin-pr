'use strict';

const db = require.main.require('./src/database');
const helpers = require.main.require('./src/controllers/helpers');

const Utility = require('./utility/misc');
const { catchApiException, catchActionException } = require('./utility/controllerhelper');

const { pr_lock, pr_unlock } = Utility;

const Register = {};

Register.check = async (payload) => {
	Utility.debug('Register check');
	Utility.inspect(payload.userData);
	const { noscript, uuid, invite, username, password } = payload.userData;
	if (invite) {
		const inviteStatus = await db.getObject(`pr:invite:${invite}`);
		if (!inviteStatus) {
			throw new Error('Invalid invite code');
		} else if (inviteStatus.count <= 0) {
			throw new Error('This invite code has been used up');
		}
	} else if (uuid) {
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

Register.abort = catchActionException(async (payload) => {
	Utility.debug('Regiser abort');
	Utility.inspect(payload.req.session);
	const { uuid, invite, username, password, pr_interstitial_done } = payload.req.session.registration;
	if (!pr_interstitial_done) {
		return;
	}
	if (invite) {
		await db.incrObjectField(`pr:invite:${invite}`, 'count');
	} else if (uuid) {
		await db.setObjectField(`pr:dkim:uuid:${uuid}`, 'status', 'success');
	} else {
		const regreq = `${username}\n${password}`;
		await db.setRemove('pr:regreq_done', regreq);
	}
});

Register.interstitial = async (payload) => {
	Utility.debug('Register interstitial');
	Utility.inspect(payload.userData);
	const { req, userData } = payload;
	if (req.method !== 'POST') {
		return payload;
	}
	// Don't do anything for registered users
	if (req.uid > 0) {
		return payload;
	}
	const { uuid, invite, username, password } = userData;
	// Don't activate when user POST at first page /register, when user has not yet read the "complete" page warnings
	// Use route path instead of absolute path, because website can be prefixed
	if (req.route.path === '/register/complete' && !userData.pr_interstitial_done) {
		// Fix: also add check at interstitial
		if (invite) {
			// Don't lock here, since invite may not be unique
			const count = await db.decrObjectField(`pr:invite:${invite}`, 'count');
			if (count < 0) {
				throw new Error('This invite code has been used up');
			}
			userData.pr_interstitial_done = true;
		} else if (uuid) {
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

async function set_invite(req, res) {
	const { invite, count, type } = req.body;
	const payload = { invite, count, type };
	await db.setObject(`pr:invite:${invite}`, payload);
	return helpers.formatApiResponse(200, res, payload);
}

Register.set_invite = catchApiException(set_invite);

module.exports = Register;
