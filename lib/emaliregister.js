'use strict';

const net = require.main.require('net');
const dns = require.main.require('dns');
const crypto = require.main.require('crypto');
const buffer = require.main.require('buffer');
const { Buffer } = buffer;
const meta = require.main.require('./src/meta');
const db = require.main.require('./src/database');

const { pr_lock, pr_unlock } = require('./utility');

const EmailRegister = {};

async function internal_email_add({ res, helpers, from, regreq }) {
	// Check whether email address or register request is already used
	if (await db.isSetMember('pr:emailused', from)) {
		return helpers.formatApiResponse(401, res, Error(`Email Already used: ${from}`));
	}
	if (await db.isSetMember('pr:regreq', regreq)) {
		return helpers.formatApiResponse(400, res, Error(`This register request: ${regreq} is already submitted`));
	}
	// Try acquire lock
	try {
		await pr_lock('email:', from);
	} catch (e) {
		return helpers.formatApiResponse(401, res, Error(`Email Already used: ${from}`));
	}
	try {
		await pr_lock('regreq:', regreq, '');
	} catch (e) {
		await pr_unlock('email:', from);
		return helpers.formatApiResponse(400, res, Error(`This register request: ${regreq} is already submitted`));
	}
	await db.setAdd('pr:emailused', from);
	await db.setAdd('pr:regreq', regreq);
	await pr_unlock('regreq:', regreq);
	await pr_unlock('email:', from);
	// Successful return
	helpers.formatApiResponse(200, res, {
		email_used: from,
	});
}

function tryDecrypt(body, pr_sk_base64) {
	const PREFIX = 'USeRnaMe\n';
	let pr_sk;
	try {
		const pr_sk_str = Buffer.from(pr_sk_base64, 'base64');
		pr_sk = crypto.createPrivateKey(pr_sk_str);
		pr_sk.oaepHash = 'sha256';
		// Buffer.from(string) returns empty buffer instead of throwing on invalid base64 encodings
	} catch (e) {
		// This should only comes from crypto.createPrivateKey(), which means pr_sk_base64 is invalid
		console.log(e);
		return { decres: '5xx', regreq: null };
	}
	try {
		const regreq_enc_buf = Buffer.from(body, 'base64');
		const regreq_dec_buf = crypto.privateDecrypt(pr_sk, regreq_enc_buf);
		let regreq = regreq_dec_buf.toString();
		if (!regreq.startsWith(PREFIX)) {
			return { decres: '4xx', regreq: null };
		}
		regreq = regreq.substring(PREFIX.length);
		return { decres: '2xx', regreq: regreq };
	} catch (e) {
		// Decryption error
		return { decres: '4xx', regreq: null };
	}
}

function tryDecryptAll(arr, pr_sk_base64) {
	let res = {};
	for (const body of arr) {
		res = tryDecrypt(body, pr_sk_base64);
		if (res.decres !== '4xx') {
			break;
		}
	}
	return res;
}

function suffix_includes(str_array, match) {
	for (const item of str_array) {
		if (item.endsWith(match)) {
			return true;
		}
	}
	return false;
}

EmailRegister.email_add = async function (req, res, { helpers }) {
	const {
		register_token: pr_register_token,
		register_sk: pr_sk_base64,
	} = await meta.settings.get('pr');
	const skreq = req.params.sk || '';
	if (pr_register_token !== skreq) {
		return helpers.formatApiResponse(404, res, null);
	}
	const { from, plain, subject } = req.body;
	const { decres, regreq } = tryDecryptAll([plain, subject], pr_sk_base64);
	if (decres === '5xx') {
		return helpers.formatApiResponse(502, res, null);
	} else if (decres !== '2xx') {
		return helpers.formatApiResponse(403, res, Error('Invalid register request'));
	}
	await internal_email_add({ res, helpers, from, regreq });
};

EmailRegister.email_cloudmailin = async function (req, res, { helpers }) {
	// helpers.formatApiResponse() will generate predefined error if third argument left null
	const {
		register_token: pr_register_token,
		register_sk: pr_sk_base64,
		register_helo_domains: pr_helo_domain_str,
		register_from_domains: pr_from_domain_str,
	} = await meta.settings.get('pr');
	const skreq = req.params.sk || '';
	if (pr_register_token !== skreq) {
		return helpers.formatApiResponse(404, res, null);
	}
	const { headers, envelope } = req.body;
	if (!headers || !envelope) {
		return helpers.formatApiResponse(403, res, Error('No headers or envelope'));
	}
	const { from, helo_domain, remote_ip } = envelope;
	if (!net.isIP(remote_ip)) {
		return helpers.formatApiResponse(403, res, Error('Not an ip addr'));
	}
	// Mandatory reverse DNS check. This must resolves to helo_domain
	let reverse_domains = [];
	try {
		reverse_domains = await dns.promises.reverse(remote_ip);
		if (!reverse_domains || (helo_domain && !suffix_includes(reverse_domains, helo_domain))) {
			return helpers.formatApiResponse(403, res, Error(`Reverse DNS check failed: ip ${remote_ip} resolves to ${reverse_domains}, which does not match ${helo_domain}`));
		}
	} catch (e) {
		return helpers.formatApiResponse(403, res, Error(`Reverse DNS check failed: ${e}`));
	}

	// Verify "From" domain, which must match its helo_domain
	const from_domain = from.substring(from.indexOf('@') + 1);
	// Verify reverse_domain

	// Currently subdomains are unconditionally trusted. This is insecure in theory,
	// but currently our valid domains doesn't provide subdomain to other vendors
	const pr_reverse_domains = pr_helo_domain_str.split(';');
	const pr_from_domains = pr_from_domain_str.split(';');
	let is_valid_reverse_domain = false;
	for (let i = 0; i < pr_reverse_domains.length; i++) {
		const pr_dns_dm = pr_reverse_domains[i];
		const pr_from_dm = pr_from_domains[i];
		const reverse_find = suffix_includes(reverse_domains, pr_dns_dm);
		if (reverse_find && from_domain === pr_from_dm) {
			is_valid_reverse_domain = true;
			break;
		}
	}
	if (!is_valid_reverse_domain) {
		return helpers.formatApiResponse(403, res, Error(`Invalid HELO domain: ip ${remote_ip} resolves to ${reverse_domains}, from ${from}, helo ${helo_domain}`));
	}
	// reverse DNS check, helo_domain and "From" domain check passed
	// Now start to parse email content to get register request
	const subject = headers.subject || '';
	const plain = req.body.plain || '';
	// Try plaintext (email body) first, if failed try subject
	const { decres, regreq } = tryDecryptAll([plain, subject], pr_sk_base64);
	if (decres === '5xx') {
		return helpers.formatApiResponse(502, res, null);
	} else if (decres !== '2xx') {
		return helpers.formatApiResponse(403, res, Error('Invalid register request'));
	}
	// Decryption successful. Try to add register request and email address to database
	internal_email_add({ res, helpers, from, regreq });
};

module.exports = EmailRegister;
