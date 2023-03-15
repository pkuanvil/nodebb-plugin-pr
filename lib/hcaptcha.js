'use strict';

const https = require('https');
const querystring = require('querystring');

const nconf = require.main.require('nconf');

const HCAPTCHA_SECRET_KEY = nconf.get('hcaptcha:secretkey');
const HCAPTCHA_SITE_KEY = nconf.get('hcaptcha:sitekey');
const HCAPTCHA_HOST = 'hcaptcha.com';
const HCAPTCHA_VERIFY_URL = 'https://hcaptcha.com/siteverify';

const hcaptcha = module.exports;
const relative_path = nconf.get('relative_path');
const captcha_path = `${relative_path}/captcha`;
const home_path = `${relative_path}/`;

const CAPTCHA_INIT_SCORE = 500;
const CAPTCHA_MAX_SCORE = 2000;
// Recover in 1 day
const CAPTCHA_TIME_RECOVER_RATE = (CAPTCHA_MAX_SCORE - CAPTCHA_INIT_SCORE) / 86400;

// Only penatize login for now
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
	return result;
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

hcaptcha.needCaptcha = async (req, res, next) => {
	// Don't store anything in req.session, unless the guest completed a captcha
	function redirectCaptcha(req, res) {
		// return X-Redirect on all calls, even in HTTP redirect, since jQuery don't expose 3xx anyway
		if (req.originalUrl.startsWith('/api')) {
			// Redirect to path without '/api'
			const redirect = `${captcha_path}?returnto=${querystring.escape(req.originalUrl.substring('/api'.length))}`;
			res.setHeader('X-Redirect', redirect);
			res.status(200).send(redirect);
			return;
		}
		const redirect = `${captcha_path}?returnto=${querystring.escape(req.originalUrl.substring('/api'.length))}`;
		res.setHeader('X-Redirect', redirect);
		return res.redirect(303, redirect);
	}
	if (req.user || req.session.captcha || req.isSpider()) {
		return next();
	}
	const score = pathScore(req);
	if (
		(!req.session.pr_captchaScore && score) ||
		(req.session.pr_captchaScore < score)
	) {
		return redirectCaptcha(req, res);
	}
	updateScore(req);
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
		return res.redirect(303, `${captcha_path}?failed=true`);
	}
	req.session.pr_captchaScore = CAPTCHA_INIT_SCORE;
	req.session.pr_CaptchaSeconds = process.hrtime()[0];
	const referrer = req.get('Referrer');
	const query = new URL(referrer).searchParams;
	const returnURL = query.get('returnto') ? querystring.unescape(query.get('returnto')) : home_path;
	res.redirect(303, returnURL);
};
