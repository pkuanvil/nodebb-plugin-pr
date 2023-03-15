'use strict';

const https = require('https');
const querystring = require('querystring');
const util = require('node:util');

const nconf = require.main.require('nconf');
const { formatApiResponse } = require.main.require('./src/controllers/helpers');

const HCAPTCHA_SECRET_KEY = nconf.get('hcaptcha:secretkey');
const HCAPTCHA_SITE_KEY = nconf.get('hcaptcha:sitekey');
const HCAPTCHA_HOST = 'hcaptcha.com';
const HCAPTCHA_VERIFY_URL = 'https://hcaptcha.com/siteverify';

function startSlash(path) {
	if (!path.startsWith('/')) {
		return `/${path}`;
	}
	return path;
}

const hcaptcha = module.exports;
// Relative path never ends with '/'
const relative_path = startSlash(nconf.get('relative_path'));
// The following path always starts with '/'
const asset_path = nconf.get('asset_base_url');
const captcha_path = relative_path !== '/' ? `${relative_path}/captcha` : '/captcha';
const home_path = relative_path;

const CAPTCHA_INIT_SCORE = 500;
const CAPTCHA_MAX_SCORE = 2000;
// Recover in 1 day
const CAPTCHA_TIME_RECOVER_RATE = (CAPTCHA_MAX_SCORE - CAPTCHA_INIT_SCORE) / 86400;

function pathScore(req) {
	let result = 0;
	const path = req.originalUrl;
	const writeMethods = ['POST', 'PUT', 'DELETE'];
	if (path.startsWith('/login') || path.startsWith('/api/login') || path.startsWith('/api/v3/utilities/login')) {
		if (writeMethods.includes(req.method)) {
			result += 500;
		} else {
			// Small non-zero number
			result += 1;
		}
	}
	if (path.startsWith('/api/v3/topics') && writeMethods.includes(req.method)) {
		result += 100;
	}
	return result;
}

function statAPICall(req) {
	const result = {
		redirect: req.originalUrl,
		isAPIRedirect: false,
		isAPIError: false,
	};
	if (req.originalUrl.startsWith('/api')) {
		if (req.originalUrl.startsWith('/api/v3/topics')) {
			result.isAPIError = true;
			result.redirect = req.get('Referrer');
		} else {
			result.isAPIRedirect = true;
			result.redirect = req.originalUrl.substring('/api'.length);
		}
	} else if (req.originalUrl.startsWith('/login') && req.method === 'POST') {
		result.isAPIRedirect = true;
	}
	return result;
}

function removeQuery(path) {
	const q = path.indexOf('?');
	if (q !== -1) {
		path = path.substring(0, q);
	}
	return path;
}

function noRedirect(path) {
	path = removeQuery(path);
	const allowed_prefixes = [asset_path, captcha_path];
	const allowed_suffixes = ['.js', '.webmanifest'];
	for (const prefix of allowed_prefixes) {
		if (path.startsWith(prefix)) {
			return true;
		}
	}
	for (const suffix of allowed_suffixes) {
		if (path.endsWith(suffix)) {
			return true;
		}
	}
	return false;
}

function updateScore(req) {
	const currentTime = process.hrtime()[0];
	const timeDiff = currentTime - req.session.pr_CaptchaSeconds;
	req.session.pr_CaptchaSeconds = currentTime;
	req.session.pr_captchaScore += Math.min(
		CAPTCHA_MAX_SCORE - req.session.pr_captchaScore,
		timeDiff * CAPTCHA_TIME_RECOVER_RATE,
	);
	req.session.pr_captchaScore -= pathScore(req);
}

const regenerateAsync = util.promisify((req, callback) => req.session.regenerate(callback));

hcaptcha.needCaptcha = async (req, res, next) => {
	// Don't store anything in req.session, unless the guest completed a captcha
	async function redirectCaptcha(req, res) {
		const stat = statAPICall(req);
		// Return absolute URL to stop ajaxify from infinitely trying ajaxify.go()
		// See https://github.com/NodeBB/NodeBB/blob/v2.8.8/public/src/ajaxify.js#L171
		const scheme = req.secure ? 'https' : 'http';
		const redirect = `${scheme}://${req.hostname}${captcha_path}?returnto=${querystring.escape(stat.redirect)}`;
		// return X-Redirect on all calls, even in HTTP redirect, since jQuery don't expose 3xx anyway
		if (stat.isAPIRedirect) {
			// Redirect to path without '/api'
			res.setHeader('X-Redirect', redirect);
			res.status(200).send(redirect);
			return;
		} else if (stat.isAPIError) {
			res.setHeader('X-Redirect', redirect);
			return await formatApiResponse(403, res, new Error(`[[pr:captcha-prompt, ${scheme}://${req.hostname}${captcha_path}]]`));
		}
		res.setHeader('X-Redirect', redirect);
		return res.redirect(303, redirect);
	}
	if (req.user || req.session.captcha || req.isSpider()) {
		return next();
	}
	if (noRedirect(req.originalUrl)) {
		return next();
	}
	const score = pathScore(req);
	// !pr_captchaScore means session uninitialized
	if (typeof req.session.pr_captchaScore === 'undefined' && score) {
		return await redirectCaptcha(req, res);
	}
	// Don't force captcha even in [0, score), since it could be a successful login
	if (req.session.pr_captchaScore < 0) {
		// captcha score negative, clean up session and treat as a new guest
		await regenerateAsync(req);
		return await redirectCaptcha(req, res);
	}
	if (typeof req.session.pr_captchaScore !== 'undefined') {
		updateScore(req);
	}
	next();
};

const setData = (error) => {
	const data = {};
	data.sitekey = HCAPTCHA_SITE_KEY;
	if (error) {
		data.error = error;
	}
	return data;
};

hcaptcha.get = async function (req, res) {
	res.render('hcaptcha', setData());
};

// Modified from https://github.com/vastus/node-hcaptcha/blob/master/index.js
hcaptcha.sendResponse = req => new Promise((resolve, reject) => {
	const token = req.body ? req.body['h-captcha-response'] : '';
	if (!token) {
		reject(new Error('No response for captcha'));
	}
	const payload = { secret: HCAPTCHA_SECRET_KEY, response: token };
	const data = JSON.stringify(payload);
	const options = {
		host: HCAPTCHA_HOST,
		path: HCAPTCHA_VERIFY_URL,
		method: 'POST',
		headers: {
			'content-type': 'application/json',
			'content-length': Buffer.byteLength(data),
		},
	};

	const h_request = https.request(options, (response) => {
		response.setEncoding('utf8');

		let buffer = '';

		response
			.on('error', reject)
			// eslint-disable-next-line no-return-assign
			.on('data', chunk => buffer += chunk)
			.on('end', () => {
				try {
					const json = JSON.parse(buffer);
					resolve(json);
				} catch (error) {
					reject(error);
				}
			});
	});

	h_request.on('error', reject);
	h_request.write(data);
	h_request.end();
});

hcaptcha.post = async (req, res) => {
	try {
		await hcaptcha.sendResponse(req);
	} catch (e) {
		// No ajaxify here so this should refresh to a new page
		res.status(403);
		return res.render('hcaptcha', setData(e.toString()));
	}
	req.session.pr_captchaScore = CAPTCHA_INIT_SCORE;
	req.session.pr_CaptchaSeconds = process.hrtime()[0];
	const referrer = req.get('Referrer');
	const query = new URL(referrer).searchParams;
	const returnURL = query.get('returnto') ? querystring.unescape(query.get('returnto')) : home_path;
	res.redirect(303, returnURL);
};
