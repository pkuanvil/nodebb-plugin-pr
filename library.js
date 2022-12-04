'use strict';

const nconf = require.main.require('nconf');
const winston = require.main.require('winston');
const net = require.main.require('net')
const dns = require.main.require('dns')
const crypto = require.main.require('crypto')
const buffer = require.main.require('buffer')
const Buffer = buffer.Buffer

const meta = require.main.require('./src/meta');
const db = require.main.require('./src/database')

const controllers = require('./lib/controllers');

const routeHelpers = require.main.require('./src/routes/helpers');

const plugin = {};

plugin.init = async (params) => {
	const { router /* , middleware , controllers */ } = params;

	// Settings saved in the plugin settings can be retrieved via settings methods
	const { setting1, setting2 } = await meta.settings.get('pr');
	if (setting1) {
		console.log(setting2);
	}

	/**
	 * We create two routes for every view. One API call, and the actual route itself.
	 * Use the `setupPageRoute` helper and NodeBB will take care of everything for you.
	 *
	 * Other helpers include `setupAdminPageRoute` and `setupAPIRoute`
	 * */
	routeHelpers.setupPageRoute(router, '/pr', [(req, res, next) => {
		winston.info(`[plugins/pr] In middleware. This argument can be either a single middleware or an array of middlewares`);
		setImmediate(next);
	}], (req, res) => {
		winston.info(`[plugins/pr] Navigated to ${nconf.get('relative_path')}/pr`);
		res.render('pr', { uid: req.uid });
	});

	routeHelpers.setupAdminPageRoute(router, '/admin/plugins/pr', [], controllers.renderAdminPage);
};

/**
 * If you wish to add routes to NodeBB's RESTful API, listen to the `static:api.routes` hook.
 * Define your routes similarly to above, and allow core to handle the response via the
 * built-in helpers.formatApiResponse() method.
 *
 * In this example route, the `ensureLoggedIn` middleware is added, which means a valid login
 * session or bearer token (which you can create via ACP > Settings > API Access) needs to be
 * passed in.
 *
 * To call this example route:
 *   curl -X GET \
 * 		http://example.org/api/v3/plugins/pr/test \
 * 		-H "Authorization: Bearer some_valid_bearer_token"
 *
 * Will yield the following response JSON:
 * 	{
 *		"status": {
 *			"code": "ok",
 *			"message": "OK"
 *		},
 *		"response": {
 *			"foobar": "test"
 *		}
 *	}
 */

function tryDecrypt(body, pr_sk_base64) {
	const PREFIX = 'USeRnaMe\n'
	let pr_sk
	try {
		const pr_sk_str = Buffer.from(pr_sk_base64, 'base64')
		pr_sk = crypto.createPrivateKey(pr_sk_str)
		pr_sk.oaepHash = 'sha256'
		// Buffer.from(string) returns empty buffer instead of throwing on invalid base64 encodings
	} catch (e) {
		// This should only comes from crypto.createPrivateKey(), which means pr_sk_base64 is invalid
		console.log(e)
		return { "decres": "5xx", "regreq": null }
	}
	try {
		const regreq_enc_buf = Buffer.from(body, 'base64')
		const regreq_dec_buf = crypto.privateDecrypt(pr_sk, regreq_enc_buf)
		let regreq = regreq_dec_buf.toString()
		if (!regreq.startsWith(PREFIX)) {
			return { "decres": "4xx", "regreq": null }
		}
		regreq = regreq.substring(PREFIX.length)
		return { "decres": "2xx", "regreq": regreq }
	} catch (e) {
		// Decryption error
		return { "decres": "4xx", "regreq": null }
	}
}

function tryDecryptAll(arr, pr_sk_base64) {
	let res = {}
	for (let body of arr) {
		res = tryDecrypt(body, pr_sk_base64)
		if (res.decres !== "4xx") {
			break
		}
	}
	return res
}

// prefix must not exceed 15 chars
const PREFIX_MAX_LEN = 15
async function pr_lock(prefix, value, error) {
	const count = await db.incrObjectField('pr:locks', prefix.padStart(PREFIX_MAX_LEN, '0') + value)
	if (count > 1) {
		throw new Error(error)
	}
}

async function pr_unlock(prefix, value) {
	await db.deleteObjectField('pr:locks', prefix.padStart(PREFIX_MAX_LEN, '0') + value)
}

plugin.addRoutes = async ({ router, middleware, helpers }) => {
	const middlewares = [
		// middleware.ensureLoggedIn,		// use this if you want only registered users to call this route
		// middleware.admin.checkPrivileges,	// use this to restrict the route to administrators
	];

	// Don't use routeHelpers.setupApiRoute() since we don't want bear authentication token or csrf token here
	router.get('/pr_pubkey', async (req, res) => {
		const pr_sk_base64 = await meta.settings.getOne('pr', 'register_sk')
		const pr_sk_str = Buffer.from(pr_sk_base64, 'base64')
		const pr_pubkey = crypto.createPublicKey(pr_sk_str)
		const pr_pubkey_str = pr_pubkey.export({ type: "spki", format: "pem" })
		res.status(200).type('text/plain').send(pr_pubkey_str)
	})
	router.get('/pr_register_email', async (req, res) => {
		const email = await meta.settings.getOne('pr', 'register_email')
		res.status(200).type('text/plain').send(email)
	})
	router.post('/pr_EmailRegReq/:sk', async (req, res) => {
		// helpers.formatApiResponse() will generate predefined error if third argument left null
		const { register_token: pr_register_token,
			register_sk: pr_sk_base64,
			register_helo_domains: pr_helo_domain_str,
			register_from_domains: pr_from_domain_str
		} = await meta.settings.get('pr')
		const skreq = req.params.sk || ""
		if (pr_register_token !== skreq) {
			return helpers.formatApiResponse(404, res, null)
		}
		const { headers, envelope } = req.body
		if (!headers || !envelope) {
			return helpers.formatApiResponse(403, res, Error("No headers or envelope"))
		}
		const { from, helo_domain, remote_ip, tls, tls_cipher } = envelope
                if (!tls || (tls_cipher !== "TLSv1.3" && tls_cipher !== "TLSv1.2")) {
                        if (!from.endsWith("pku.edu.cn")) {
				return helpers.formatApiResponse(403, res, Error("Invalid TLS cipher"))
                        }
                }

		if (!net.isIP(remote_ip)) {
			return helpers.formatApiResponse(403, res, Error("Not an ip addr"))
		}
		// Mandatory reverse DNS check. This must resolves to helo_domain
		let reverse_domains = []
		try {
			reverse_domains = await dns.promises.reverse(remote_ip)
			if (!reverse_domains || (helo_domain && !reverse_domains.includes(helo_domain))) {
				return helpers.formatApiResponse(403, res, Error(`Reverse DNS check failed: ip ${remote_ip} resolves to ${reverse_domains}, which does not match ${helo_domain}`))
			}
		} catch (e) {
			return helpers.formatApiResponse(403, res, Error(`Reverse DNS check failed: ${e}`))
		}

		// Verify "From" domain, which must match its helo_domain
		const from_domain = from.substring(from.indexOf("@") + 1)
		// Verify reverse_domain

		// Currently subdomains are unconditionally trusted. This is insecure in theory, 
		// but currently our valid domains doesn't provide subdomain to other vendors
		const pr_reverse_domains = pr_helo_domain_str.split(";")
		const pr_from_domains = pr_from_domain_str.split(";")
		let is_valid_reverse_domain = false
		for (let i = 0; i < pr_reverse_domains.length; i++) {
			let pr_dns_dm = pr_reverse_domains[i]
			let pr_from_dm = pr_from_domains[i]
			let reverse_find = false
			for (let reverse_1 of reverse_domains) {
				if (reverse_1.endsWith(pr_dns_dm)) {
					reverse_find = true
					break
				}
			}
			if (reverse_find && from_domain === pr_from_dm) {
				is_valid_reverse_domain = true
				break
			}
		}
		if (!is_valid_reverse_domain) {
			return helpers.formatApiResponse(403, res, Error(`Invalid HELO domain: ip ${remote_ip} resolves to ${reverse_domains}, from ${from}, helo ${helo_domain}`))
		}
		// reverse DNS check, helo_domain and "From" domain check passed
		// Now start to parse email content to get register request
		const subject = headers.subject || ""
		const plain = req.body.plain || ""
		// Try plaintext (email body) first, if failed try subject
		let { decres, regreq } = tryDecryptAll([plain, subject], pr_sk_base64)
		if (decres === "5xx") {
			return helpers.formatApiResponse(502, res, null)
		} else if (decres !== "2xx") {
			return helpers.formatApiResponse(403, res, Error("Invalid register request"))
		}
		// Decryption successful. Add register request and email address to database
		// Check whether email address or register request is already used
		if (await db.isSetMember("pr:emailused", from)) {
			return helpers.formatApiResponse(401, res, Error(`Email Already used: ${from}`))
		}
		if (await db.isSetMember("pr:regreq", regreq)) {
			return helpers.formatApiResponse(400, res, Error(`This register request: ${regreq} is already submitted`))
		}
		// Try acquire lock
		try {
			await pr_lock("email:", from)
		} catch (e) {
			return helpers.formatApiResponse(401, res, Error(`Email Already used: ${from}`))
		}
		try {
			await pr_lock("regreq:", regreq, "")
		} catch (e) {
			await pr_unlock("email:", from)
			return helpers.formatApiResponse(400, res, Error(`This register request: ${regreq} is already submitted`))
		}
		await db.setAdd("pr:emailused", from)
		await db.setAdd("pr:regreq", regreq)
		await pr_unlock("regreq:", regreq)
		await pr_unlock("email:", from)
		// Successful return
		helpers.formatApiResponse(200, res, {
			email_used: from
		});
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

plugin.regCheck = async (payload) => {
	let { userData } = payload
	const regreq = userData.username + '\n' + userData.password
	if (! await db.isSetMember("pr:regreq", regreq)) {
		throw new Error("The Server has not received your register request.")
	} else if (await db.isSetMember("pr:regreq_done", regreq)) {
		throw new Error("This register request has already been completed.")
	}
}

plugin.interstitial = async (payload) => {
	let { req, userData } = payload
	if (req.method !== "POST") {
		return payload
	}
	// Don't activate when user POST at first page /register, when user has not yet read the "complete" page warnings
	// Use route path instead of absolute path, because website can be prefixed
	if (req.route.path === "/register/complete") {
		const regreq = userData.username + '\n' + userData.password
		await db.setAdd("pr:regreq_done", regreq)
	}
	return payload
}

module.exports = plugin;
