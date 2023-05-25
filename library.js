'use strict';

const nconf = require.main.require('nconf');
const crypto = require.main.require('crypto');
const buffer = require.main.require('buffer');
const { Buffer } = buffer;
const _ = require.main.require('lodash');
const winston = require.main.require('winston');

const __multipart = require.main.require('connect-multiparty');
const TMP_UPLOAD_DIR = process.platform === 'linux' ? '/var/tmp' : undefined;

const meta = require.main.require('./src/meta');
const db = require.main.require('./src/database');
const topics = require.main.require('./src/topics');
const user = require.main.require('./src/user');

const blockTag = require('./lib/blocktag');
const controllers = require('./lib/controllers');
const hcaptcha = require('./lib/hcaptcha');
const { email_add, email_postmark } = require('./lib/email/sendmessage');
const Dkim = require('./lib/email/dkim');
const Utility = require('./lib/utility/misc');
const Privacy = require('./lib/privacy');
const Register = require('./lib/register');
const EmailUserType = require('./lib/email/usertype');
const Excerpt = require('./lib/excerpt');

const USE_HCAPTCHA = nconf.get('use_hcaptcha');

const routeHelpers = require.main.require('./src/routes/helpers');
const controllerHelpers = require.main.require('./src/controllers/helpers');

const plugin = {};
Utility.injectHookName(plugin);

const __multipartMiddleWare = __multipart({ uploadDir: TMP_UPLOAD_DIR });
function multipartCheck(req, res, next) {
	if (!req.header('Content-Type') || !req.header('Content-Type').startsWith('multipart/form-data')) {
		return controllerHelpers.formatApiResponse(
			403,
			res,
			Error(`Invalid HTTP header "Content-Type: ${req.header('Content-Type')}"`)
		);
	}
	return __multipartMiddleWare(req, res, next);
}

plugin.static.app.load = async (params) => {
	const { router /* , middleware , controllers */ } = params;

	routeHelpers.setupAdminPageRoute(router, '/admin/plugins/pr', [], controllers.renderAdminPage);
	if (USE_HCAPTCHA) {
		// We want default html template from renderHeader()
		routeHelpers.setupPageRoute(router, '/captcha', [], hcaptcha.get);
		router.post('/captcha', hcaptcha.post);
	}
	routeHelpers.setupPageRoute(router, '/pr_dkim_upload', Dkim.uploadGET);
	router.post('/pr_dkim_upload', [multipartCheck], Dkim.uploadPOST);
	routeHelpers.setupPageRoute(router, '/pr_dkim_register', controllers.pr_dkim_register_page);
	router.post('/pr_dkim_register', [], controllers.pr_dkim_register_post);
	routeHelpers.setupPageRoute(router, '/pr_invite_register', controllers.pr_invite_register_page);
	router.post('/pr_invite_register', [], controllers.pr_invite_register_post);
	routeHelpers.setupPageRoute(router, '/pr_email_domains', controllers.pr_email_domains);
};

plugin.static.app.preload = async (params) => {
	const { app } = params;
	if (USE_HCAPTCHA) {
		// Captcha mandatory at application-wide, unless loggged in or session already has verified captcha
		app.use(hcaptcha.needCaptcha);
	}
};

async function checkAdminSk(req, res, next) {
	const { register_token } = await meta.settings.get('pr');
	const skreq = req.params.sk || '';
	if (register_token !== skreq) {
		// 404 dont make sense here, use 403
		return controllerHelpers.formatApiResponse(403, res, null);
	}
	next();
}

plugin.static.api.routes = async ({ router }) => {
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
	router.get('/pr_DefaultBlockTags', async (req, res) => controllerHelpers.formatApiResponse(200, res, await blockTag.getDefaultTags()));
	router.post('/pr_EmailAdd/:sk', [checkAdminSk], email_add);
	router.post('/pr_EmailAddPostMark/:sk', [checkAdminSk], email_postmark);
	router.post('/pr_DKIMUUID/:uuid/:sk', [checkAdminSk], Dkim.manageUUID);
	router.post('/pr_Invite/:sk', [checkAdminSk], Register.set_invite);
};

plugin.filter.topics.get = async (payload) => {
	await Excerpt.setTopicsExcerpt(payload);
	return payload;
};

plugin.filter.teasers.configureStripTags = async (payload) => {
	payload.tags = [];
	return payload;
};

plugin.filter.teasers.get = async (payload) => {
	const { teasers } = payload;
	// This requires filter:teasers.configureStripTags to correctly strip ALL HTML
	await Excerpt.truncTeasers(teasers);
	return payload;
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

plugin.filter.register.check = Register.check;
plugin.action.pr_register.abort = Register.abort;
plugin.filter.register.interstitial = Register.interstitial;

plugin.action.user.create = async ({ user: createData, data: userData }) => {
	// This is an action hook, so manual throwing don't make sense, since it won't stop anything
	// Catch exceptions
	try {
		const { uid } = createData;
		const { uuid, invite, username, password } = userData;
		let type = '';
		if (invite) {
			type = await db.getObjectField(`pr:invite:${invite}`, 'type');
		} else if (uuid) {
			const uuidStatus = await db.getObject(`pr:dkim:uuid:${uuid}`);
			const { emailaddress } = uuidStatus;
			type = EmailUserType.getType(emailaddress);
		} else {
			const regreq = `${username}\n${password}`;
			type = await db.sortedSetScore(`pr:regreq:types`, regreq);
		}
		await user.setUserField(uid, 'pr_usertype', type);
	} catch (e) {
		winston.error(e.stack);
	}
};

plugin.filter.sanitize.config = Privacy.sanitizeHTML;

plugin.filter.pr_sanitizehtml.config = Privacy.pr_sanitizeHTML;

plugin.filter.email.params = async (payload) => {
	const { email, params } = payload;
	if (!params.email) {
		params.email = email;
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
		blockTag.getDefaultTags(),
	]);
}

plugin.filter.privileges.topics.filter = async (payload) => {
	const { privilege, uid } = payload;
	if (privilege === 'topics:read') {
		// Don't allow topic from future timestamp ("scheduled topic") to be shown, unless for topic owner
		const [topicsData] = await getFilter(payload.tids, uid);
		payload.tids = topicsData.filter(
			t => !Privacy.isFutureTopicorPost(t, uid)
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

// Fix /recent route
// Note: future check already done in privileges.topics.filter
plugin.filter.topics.filterSortedTids = async (payload) => {
	const { uid } = payload.params;
	const [topicsData, settings, defaultBlockTags] = await getFilter(payload.tids, uid);
	payload.tids = topicsData.filter(
		t => !blockTag.hasBlockedTags(t, settings, defaultBlockTags)
	)
		.map(t => t.tid);
	return payload;
};

// Fix teaser and user profile
plugin.filter.post.getPostSummaryByPids = async (payload) => {
	const { uid } = payload;
	const [topicsData, settings, defaultBlockTags] = await getFilter(payload.posts.map(p => p.tid), uid);
	// Don't add fields like 'tags' to payload.posts; only do a filter
	payload.posts = payload.posts.filter((__unused__, i) => {
		const p = topicsData[i];
		return !Privacy.isFutureTopicorPost(p, uid) && !blockTag.hasBlockedTags(p, settings, defaultBlockTags);
	});
	return payload;
};

plugin.filter.category.topics.get = async (payload) => {
	const { uid } = payload;
	const [topicsData, settings, defaultBlockTags] = await getFilter(payload.topics.map(t => t.tid), uid);
	// Don't add fields like 'tags' to payload.topics; only do a filter
	payload.topics = payload.topics.filter((__unused__, i) => {
		const t = topicsData[i];
		return !Privacy.isFutureTopicorPost(t, uid) && !blockTag.hasBlockedTags(t, settings, defaultBlockTags);
	});
	return payload;
};

function assign_if_undefined(target, source) {
	for (const [key, value] of Object.entries(source)) {
		if (typeof target[key] === 'undefined') {
			target[key] = value;
		}
	}
}

plugin.filter.user.getSettings = async (payload) => {
	const { settings } = payload;
	const defaultSettings = {
		pr_useExcerpt: 1,
	};
	assign_if_undefined(settings, defaultSettings);
	return payload;
};

plugin.filter.user.saveSettings = async (payload) => {
	Privacy.userSaveSettings(payload);
	blockTag.userSaveSettings(payload);
	Excerpt.userSaveSettings(payload);
	return payload;
};

plugin.filter.pr_user.globalDefaults = async (payload) => {
	await blockTag.pr_userGlobalDefaults(payload);
	return payload;
};

module.exports = plugin;
