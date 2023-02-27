'use strict';

const Controllers = {};
const user = require.main.require('./src/user');
const meta = require.main.require('./src/meta');
const db = require.main.require('./src/database');
const helpers = require.main.require('./src/controllers/helpers');
const authentication = require.main.require('./src/controllers/authentication');
const { escapeHTML } = require.main.require('./src/utils');

Controllers.renderAdminPage = function (req, res/* , next */) {
	/*
		Make sure the route matches your path to template exactly.

		If your route was:
			myforum.com/some/complex/route/
		your template should be:
			templates/some/complex/route.tpl
		and you would render it like so:
			res.render('some/complex/route');
	*/

	res.render('admin/plugins/pr', {});
};

// Modified from NodeBB src/controllers/index.js
// Don't handle returnTo here, returnTo only handled at /register
Controllers.pr_dkim_register_page = async function (req, res, next) {
	const registrationType = meta.config.registrationType || 'normal';

	if (registrationType === 'disabled') {
		return setImmediate(next);
	}

	let errorText;
	if (req.query.error === 'csrf-invalid') {
		errorText = '[[error:csrf-invalid]]';
	}
	try {
		if (registrationType === 'invite-only' || registrationType === 'admin-invite-only') {
			try {
				await user.verifyInvitation(req.query);
			} catch (e) {
				return res.render('400', {
					error: e.message,
				});
			}
		}
		const { uuid } = req.query;
		let toArray = [];
		let status = '';
		let reason = '';
		// req.query supports extended syntax (npm 'qs' package). Check uuid type first
		if (typeof uuid === 'string' && uuid) {
			const dkimStatus = await db.getObject(`pr:dkim:uuid:${uuid}`);
			if (dkimStatus) {
				// Do a FULL copy because db.getObject() returns the same object in case of cache
				// Note: simple ES6 Object destruct like `toArray = [...dkimStatus.toArray]` won't work,
				// because toArray elements are also objects
				toArray = structuredClone(dkimStatus.toArray);
				status = dkimStatus.status;
				reason = dkimStatus.reason;
			}
			for (const toObject of toArray) {
				// "to" can weird HTMl characters like =?utf-8?xxxxx?= <email@example.com>
				toObject.to = escapeHTML(toObject.to);
			}
		}

		const loginStrategies = require.main.require('./src/routes/authentication').getLoginStrategies();
		res.render('pr_dkim_register', {
			'register_window:spansize': loginStrategies.length ? 'col-md-6' : 'col-md-12',
			alternate_logins: !!loginStrategies.length,
			authentication: loginStrategies,

			minimumUsernameLength: meta.config.minimumUsernameLength,
			maximumUsernameLength: meta.config.maximumUsernameLength,
			minimumPasswordLength: meta.config.minimumPasswordLength,
			minimumPasswordStrength: meta.config.minimumPasswordStrength,
			breadcrumbs: helpers.buildBreadcrumbs([{
				text: '[[register:register]]',
			}]),
			regFormEntry: [],
			success: status === 'success',
			pending: status === 'pending',
			rejected: status === 'rejected',
			reason,
			uuid,
			toArray,
			error: req.flash('error')[0] || errorText,
			title: '[[pages:register]]',
		});
	} catch (err) {
		next(err);
	}
};

Controllers.pr_dkim_register_post = async function (req, res) {
	authentication.register(req, res);
};

module.exports = Controllers;
