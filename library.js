'use strict';

const nconf = require.main.require('nconf');
const crypto = require.main.require('crypto');
const buffer = require.main.require('buffer');
const { Buffer } = buffer;
const _ = require.main.require('lodash');

const multipart = require.main.require('connect-multiparty');
const TMP_UPLOAD_DIR = process.platform === 'linux' ? '/var/tmp' : undefined;

const meta = require.main.require('./src/meta');
const db = require.main.require('./src/database');
const topics = require.main.require('./src/topics');
const user = require.main.require('./src/user');

const blockTag = require('./lib/blocktag');
const controllers = require('./lib/controllers');
const hcaptcha = require('./lib/hcaptcha');
const { email_add } = require('./lib/email/sendmessage');
const Dkim = require('./lib/email/dkim');
const Utility = require('./lib/utility/misc');
const Privacy = require('./lib/privacy');

const USE_HCAPTCHA = nconf.get('use_hcaptcha');

const routeHelpers = require.main.require('./src/routes/helpers');

const plugin = {};
Utility.injectHookName(plugin);

plugin.static.app.load = async (params) => {
	const { router /* , middleware , controllers */ } = params;

	routeHelpers.setupAdminPageRoute(router, '/admin/plugins/pr', [], controllers.renderAdminPage);
	if (USE_HCAPTCHA) {
		// We want default html template from renderHeader()
		routeHelpers.setupPageRoute(router, '/captcha', [], hcaptcha.get);
		router.post('/captcha', hcaptcha.post);
	}
	routeHelpers.setupPageRoute(router, '/pr_dkim_upload', Dkim.uploadGET);
	const multipartMiddleWare = multipart({ uploadDir: TMP_UPLOAD_DIR });
	router.post('/pr_dkim_upload', [multipartMiddleWare], Dkim.uploadPOST);
	routeHelpers.setupPageRoute(router, '/pr_dkim_register', controllers.pr_dkim_register_page);
	router.post('/pr_dkim_register', [], controllers.pr_dkim_register_post);
};

plugin.static.app.preload = async (params) => {
	const { app } = params;
	if (USE_HCAPTCHA) {
		// Captcha mandatory at application-wide, unless loggged in or session already has verified captcha
		app.use(hcaptcha.needCaptcha);
	}
};

plugin.static.api.routes = async ({ router, helpers }) => {
	// Don't use routeHelpers.setupApiRoute() since we don't want bear authentication token or csrf token here
	async function checkAdminSk(req, res, next) {
		const { register_token } = await meta.settings.get('pr');
		const skreq = req.params.sk || '';
		if (register_token !== skreq) {
			return helpers.formatApiResponse(404, res, null);
		}
		next();
	}
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
	router.post('/pr_EmailAdd/:sk', [checkAdminSk], async (req, res) => {
		await email_add(req, res, { helpers });
	});
	router.post('/pr_DKIMUUID/:uuid/:sk', [checkAdminSk], Dkim.manageUUID);
};

plugin.filter.admin.header.build = (header) => {
	header.plugins.push({
		route: '/plugins/pr',
		icon: 'fa-tint',
		name: 'pr',
	});

	return header;
};

plugin.static.user.loggedOut = async (params) => {
	const { req } = params;
	// **Requires a patched nodebb at src/controllers/authentication.js
	// that changes req.session.destory() to req.session.regenerate()**
	req.session.captcha = true;
};

plugin.filter.register.check = async (payload) => {
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

plugin.action.pr_register.abort = async (payload) => {
	Utility.debug('Regiser abort');
	Utility.inspect(payload.req.session);
	const { uuid, username, password } = payload.req.session.registration;
	if (uuid) {
		await db.setObjectField(`pr:dkim:uuid:${uuid}`, 'status', 'success');
	} else {
		const regreq = `${username}\n${password}`;
		await db.setRemove('pr:regreq_done', regreq);
	}
};

plugin.filter.sanitize.config = Privacy.sanitizeHTML;

plugin.filter.pr_sanitizehtml.config = Privacy.pr_sanitizeHTML;

plugin.filter.register.interstitial = async (payload) => {
	Utility.debug('Register interstitial');
	Utility.inspect(payload.userData);
	const { req, userData } = payload;
	if (req.method !== 'POST') {
		return payload;
	}
	const { uuid, username, password } = userData;
	// Don't activate when user POST at first page /register, when user has not yet read the "complete" page warnings
	// Use route path instead of absolute path, because website can be prefixed
	if (req.route.path === '/register/complete') {
		if (uuid) {
			await db.setObjectField(`pr:dkim:uuid:${uuid}`, 'status', 'done');
		} else {
			const regreq = `${username}\n${password}`;
			await db.setAdd('pr:regreq_done', regreq);
		}
	}
	return payload;
};

plugin.filter.user.getFields = async (payload) => {
	const { users: userArray } = payload;
	Privacy.hideUserArrayFields(userArray);
	return payload;
};

const scheduleFields = ['uid', 'tid'];
const ensureDataFields = _.union(scheduleFields, Privacy.dataFields, blockTag.dataFields);

function getFilter(tids, uid) {
	return Promise.all([
		topics.getTopicsFields(tids, ensureDataFields),
		user.getSettings(uid),
	]);
}

plugin.filter.privileges.topics.filter = async (payload) => {
	const { privilege, uid } = payload;
	if (privilege === 'topics:read') {
		// Don't allow topic from future timestamp ("scheduled topic") to be shown, unless for topic owner
		const [topicsData, settings] = await getFilter(payload.tids, uid);
		payload.tids = topicsData.filter(
			t => !Privacy.isFutureTopicorPost(t, uid) && !blockTag.hasBlockedTags(t, settings)
		)
			.map(t => t.tid);
	}
	return payload;
};

// Fix /topic/{tid} route
plugin.filter.privileges.topics.get = async (payload) => {
	const { uid, tid } = payload;
	const t = await topics.getTopicFields([tid], scheduleFields);
	if (Privacy.isFutureTopicorPost(t, uid)) {
		payload.view_scheduled = false;
	}
	return payload;
};

// Fix teaser and user profile
plugin.filter.post.getPostSummaryByPids = async (payload) => {
	const { uid } = payload;
	const [topicsData, settings] = await getFilter(payload.posts.map(p => p.tid), uid);
	// Don't add fields like 'tags' to payload.posts; only do a filter
	payload.posts = payload.posts.filter((__unused__, i) => {
		const p = topicsData[i];
		return !Privacy.isFutureTopicorPost(p, uid) && !blockTag.hasBlockedTags(p, settings);
	});
	return payload;
};

plugin.filter.category.topics.get = async (payload) => {
	const { uid } = payload;
	const [topicsData, settings] = await getFilter(payload.topics.map(t => t.tid), uid);
	// Don't add fields like 'tags' to payload.topics; only do a filter
	payload.topics = payload.topics.filter((__unused__, i) => {
		const t = topicsData[i];
		return !Privacy.isFutureTopicorPost(t, uid) && !blockTag.hasBlockedTags(t, settings);
	});
	return payload;
};

plugin.filter.user.saveSettings = (payload) => {
	Privacy.userSaveSettings(payload);
	blockTag.userSaveSettings(payload);
	return payload;
};

module.exports = plugin;
