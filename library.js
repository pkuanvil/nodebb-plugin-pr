'use strict';

const nconf = require.main.require('nconf');
const crypto = require.main.require('crypto');
const buffer = require.main.require('buffer');
const { Buffer } = buffer;
const _ = require.main.require('lodash');

const meta = require.main.require('./src/meta');
const db = require.main.require('./src/database');
const topics = require.main.require('./src/topics');

const controllers = require('./lib/controllers');
const hcaptcha = require('./lib/hcaptcha');
const { email_add, email_cloudmailin } = require('./lib/emaliregister');

const USE_HCAPTCHA = nconf.get('use_hcaptcha');

const routeHelpers = require.main.require('./src/routes/helpers');

const plugin = {};

plugin.init = async (params) => {
	const { router /* , middleware , controllers */ } = params;

	routeHelpers.setupAdminPageRoute(router, '/admin/plugins/pr', [], controllers.renderAdminPage);
	if (USE_HCAPTCHA) {
		// We want default html template from renderHeader()
		routeHelpers.setupPageRoute(router, '/captcha', [], hcaptcha.get);
		router.post('/captcha', hcaptcha.post);
	}
};

plugin.preload = async (params) => {
	const { app } = params;
	if (USE_HCAPTCHA) {
		// Captcha mandatory at application-wide, unless loggged in or session already has verified captcha
		app.use(hcaptcha.needCaptcha);
	}
};

plugin.addRoutes = async ({ router, helpers }) => {
	// Don't use routeHelpers.setupApiRoute() since we don't want bear authentication token or csrf token here
	router.get('/pr_pubkey', async (req, res) => {
		const pr_sk_base64 = await meta.settings.getOne('pr', 'register_sk');
		const pr_sk_str = Buffer.from(pr_sk_base64, 'base64');
		const pr_pubkey = crypto.createPublicKey(pr_sk_str);
		const pr_pubkey_str = pr_pubkey.export({ type: 'spki', format: 'pem' });
		res.status(200).type('text/plain').send(pr_pubkey_str);
	});
	router.get('/pr_register_email', async (req, res) => {
		const email = await meta.settings.getOne('pr', 'register_email');
		res.status(200).type('text/plain').send(email);
	});
	/* Simpler admin interface which is supposed to be only used by administrators.
	   It will blindly trust the body content (but obviously still requires a secret key from adminstrator).
	   It doesn't do reverse DNS and IP checks in anyway,
	*/
	router.post('/pr_EmailAdd/:sk', async (req, res) => {
		await email_add(req, res, { helpers });
	});
	// Original Cloudmailin interface which accepts automated JSON from cloudmailin, not in use now
	router.post('/pr_EmailRegReq/:sk', async (req, res) => {
		await email_cloudmailin(req, res, { helpers });
	});
};

plugin.addAdminNavigation = (header) => {
	header.plugins.push({
		route: '/plugins/pr',
		icon: 'fa-tint',
		name: 'pr',
	});

	return header;
};

plugin.loggedOut = async (params) => {
	const { req } = params;
	// **Requires a patched nodebb at src/controllers/authentication.js
	// that changes req.session.destory() to req.session.regenerate()**
	req.session.captcha = true;
};

plugin.regCheck = async (payload) => {
	const { userData } = payload;
	if (userData.noscript === 'true') {
		throw new Error('Registeration requires JavaScript.');
	}
	const regreq = `${userData.username}\n${userData.password}`;
	if (!await db.isSetMember('pr:regreq', regreq)) {
		throw new Error('The Server has not received your register request.');
	} else if (await db.isSetMember('pr:regreq_done', regreq)) {
		throw new Error('This register request has already been completed.');
	}
};

plugin.regAbort = async (payload) => {
	const { req } = payload;
	const userData = req.session.registration;
	if (!userData) {
		return;
	}
	const regreq = `${userData.username}\n${userData.password}`;
	await db.setRemove('pr:regreq_done', regreq);
};

plugin.interstitial = async (payload) => {
	const { req, userData } = payload;
	if (req.method !== 'POST') {
		return payload;
	}
	// Don't activate when user POST at first page /register, when user has not yet read the "complete" page warnings
	// Use route path instead of absolute path, because website can be prefixed
	if (req.route.path === '/register/complete') {
		const regreq = `${userData.username}\n${userData.password}`;
		await db.setAdd('pr:regreq_done', regreq);
	}
	return payload;
};

plugin.user_whitelistFields = async (payload) => {
	const { whitelist } = payload;
	_.remove(whitelist, value => value === 'joindate');
	return payload;
};

plugin.users_addFields = async (payload) => {
	const { fields } = payload;
	_.remove(fields, value => value === 'joindate');
	return payload;
};

function isFutureTopicorPost(data, callerUid) {
	return data.timestamp && data.timestamp > Date.now() && parseInt(callerUid, 10) !== data.uid;
}

plugin.privileges_topicsFilter = async (payload) => {
	const { privilege, uid } = payload;
	if (privilege === 'topics:read') {
		// Don't allow topic from future timestamp ("scheduled topic") to be shown, unless for topic owner
		const topicsData = await topics.getTopicsFields(payload.tids, ['uid', 'tid', 'timestamp']);
		payload.tids = topicsData.filter(t => !isFutureTopicorPost(t, uid))
			.map(t => t.tid);
	}
	return payload;
};

// Fix /topic/{tid} route
plugin.privileges_topicsGet = async (payload) => {
	const { uid, tid } = payload;
	const t = await topics.getTopicFields([tid], ['uid', 'tid', 'timestamp']);
	if (isFutureTopicorPost(t, uid)) {
		payload.view_scheduled = false;
	}
	return payload;
};

// Fix teaser and user profile
plugin.post_getPostSummaryByPids = async (payload) => {
	const { uid } = payload;
	payload.posts = payload.posts.filter(p => !isFutureTopicorPost(p, uid));
	return payload;
};

plugin.category_topicsGet = async (payload) => {
	const { uid } = payload;
	payload.topics = payload.topics.filter(t => !isFutureTopicorPost(t, uid));
	return payload;
};

module.exports = plugin;
