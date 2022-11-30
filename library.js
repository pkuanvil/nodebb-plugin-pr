'use strict';

const nconf = require.main.require('nconf');
const winston = require.main.require('winston');
const net = require.main.require('net')
const dns = require.main.require('dns')
const crypto = require.main.require('crypto')
const Buffer = require.main.require('buffer')

const meta = require.main.require('./src/meta');

const controllers = require('./lib/controllers');

const routeHelpers = require.main.require('./src/routes/helpers');

const plugin = {};

plugin.init = async (params) => {
	const { router /* , middleware , controllers */ } = params;

	// Settings saved in the plugin settings can be retrieved via settings methods
	const { setting1, setting2 } = await meta.settings.get('quickstart');
	if (setting1) {
		console.log(setting2);
	}

	/**
	 * We create two routes for every view. One API call, and the actual route itself.
	 * Use the `setupPageRoute` helper and NodeBB will take care of everything for you.
	 *
	 * Other helpers include `setupAdminPageRoute` and `setupAPIRoute`
	 * */
	routeHelpers.setupPageRoute(router, '/quickstart', [(req, res, next) => {
		winston.info(`[plugins/quickstart] In middleware. This argument can be either a single middleware or an array of middlewares`);
		setImmediate(next);
	}], (req, res) => {
		winston.info(`[plugins/quickstart] Navigated to ${nconf.get('relative_path')}/quickstart`);
		res.render('quickstart', { uid: req.uid });
	});

	routeHelpers.setupAdminPageRoute(router, '/admin/plugins/quickstart', [], controllers.renderAdminPage);
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
 * 		http://example.org/api/v3/plugins/quickstart/test \
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

function tryDecrypt(body) {
	const PREFIX = 'USeRnaMe\n'
	try {
		const pr_sk = crypto.createPrivateKey(meta.settings.get("pr_register_sk"))
		// Buffer.from(string) returns empty buffer instead of throwing on invalid base64 encodings
		const regreq_enc_buf = Buffer.from(body, 'base64')
		const regreq_dec_buf = crypto.privateDecrypt(pr_sk, regreq_enc_buf)
		let regreq = regreq_dec_buf.toString()
		if (!regreq.startsWith(PREFIX)) {
			return { "decres": "4xx", "regreq": null }
		}
		regreq = regreq.substring(PREFIX.length)
		return { "decres": "2xx", "regreq": regreq }
	} catch (e) {
		// This should only comes from crypto.createPrivateKey(), which means pr_register_sk is invalid
		return { "decres": "5xx", "regreq": null }
	}
}

function tryDecryptAll(arr) {
	let res = {}
	for (body of arr) {
		res = tryDecrypt(body)
		if (res.decres !== "4xx") {
			break
		}
	}
	return res
}

plugin.addRoutes = async ({ router, middleware, helpers }) => {
	const middlewares = [
		// middleware.ensureLoggedIn,		// use this if you want only registered users to call this route
		// middleware.admin.checkPrivileges,	// use this to restrict the route to administrators
	];

	routeHelpers.setupApiRoute(router, 'post', '/pr_EmailRegReq', middlewares, async (req, res) => {
		// helpers.formatApiResponse() will generate predefined error if third argument left null
		const pr_register_token = meta.settings.get("pr_register_token")
		const skreq = req.params.sk || ""
		if (pr_register_token !== skreq) {
			return helpers.formatApiResponse(404, res, null)
		}
		const { headers, envelope } = req.body
		if (!headers || !envelope) {
			return helpers.formatApiResponse(403, res, null)
		}
		const { from, helo_domain, remote_ip, tls, tls_cipher } = envelope
		if (!tls || (tls_cipher !== "TLSv1.3" && tls_cipher !== "TLSv1.2")) {
			return helpers.formatApiResponse(403, res, null)
		}
		if (!net.isIP(remote_ip)) {
			return helpers.formatApiResponse(403, res, null)
		}
		// Mandatory reverse DNS check. This must resolves to helo_domain
		try {
			const reverse_domain = await dns.promises.reverse(remote_ip)
			if (reverse_domain !== helo_domain) {
				return helpers.formatApiResponse(403, res, null)
			}
		} catch (e) {
			return helpers.formatApiResponse(403, res, null)
		}
		// Verify helo_domain.
		// Currently subdomains are unconditionally trusted. This is insecure in theory, 
		// but currently our valid domains doesn't provide subdomain to other vendors
		const pr_helo_domains = pr_helo_domain_str.split(";")
		const pr_from_domains = pr_from_domain_str.split(";")
		let is_valid_helo_domain = false
		let pr_from_domain = ""
		for (let i = 0; i < pr_helo_domains.length; i++) {
			let pr_helo_dm = pr_helo_domains[i]
			let pr_from_dm = pr_from_domains[i]
			if (helo_domain.endsWith(pr_helo_dm)) {
				is_valid_helo_domain = true
				pr_from_domain = pr_from_dm
			}
		}
		if (!is_valid_helo_domain) {
			return helpers.formatApiResponse(403, res, null)
		}
		// Verify "From" domain, which must match its helo_domain
		const from_domain = from.substring(from.indexOf("@") + 1)
		if (from_domain !== pr_from_domain) {
			return helpers.formatApiResponse(403, res, null)
		}
		// reverse DNS check, helo_domain and "From" domain check passed
		// Check whether email address is already used


		// Email address not previously used
		// Now start to parse email content to get register request
		const subject = headers.subject || ""
		const plain = req.body.plain || ""
		// Try plaintext (email body) first, if failed try subject
		let { decres, regreq } = tryDecryptAll([plain, subject])
		if (decres === "5xx") {
			return helpers.formatApiResponse(502, res, null)
		} else if (decres !== "2xx") {
			return helpers.formatApiResponse(403, res, Error("Invalid register request"))
		}
		// Decryption successful. Add register request and email address to database


		// Successful return
		helpers.formatApiResponse(200, res, {
			email_used: from
		});
	});
};

plugin.addAdminNavigation = (header) => {
	header.plugins.push({
		route: '/plugins/quickstart',
		icon: 'fa-tint',
		name: 'Quickstart',
	});

	return header;
};

module.exports = plugin;
