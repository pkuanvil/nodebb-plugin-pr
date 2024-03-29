'use strict';

const Controllers = {};
const user = require.main.require('./src/user');
const meta = require.main.require('./src/meta');
const db = require.main.require('./src/database');
const helpers = require.main.require('./src/controllers/helpers');
const plugins = require.main.require('./src/plugins');
const authentication = require.main.require('./src/controllers/authentication');

const { toArrayEscapeHTML, catchApiException } = require('./utility/controllerhelper');
const EmailUserType = require('./email/usertype');

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
				toArray = toArrayEscapeHTML(dkimStatus.toArray);
				status = dkimStatus.status;
				reason = dkimStatus.reason;
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

// Modified from NodeBB src/controllers/index.js
// Don't handle returnTo here, returnTo only handled at /register
Controllers.pr_invite_register_page = async function (req, res, next) {
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
		const { invite } = req.query;

		const loginStrategies = require.main.require('./src/routes/authentication').getLoginStrategies();
		res.render('pr_invite_register', {
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
			invite,
			error: req.flash('error')[0] || errorText,
			title: '[[pages:register]]',
		});
	} catch (err) {
		next(err);
	}
};

Controllers.pr_dkim_register_post = catchApiException(authentication.register);

Controllers.pr_invite_register_post = catchApiException(authentication.register);

Controllers.pr_email_domains = async function (req, res) {
	const domains = [];
	for (const value of EmailUserType.types.values()) {
		const { name: type, from: fromAll } = value;
		for (const domain of fromAll) {
			domains.push({ type, domain });
		}
	}
	res.render('pr_email_domains', {
		domains,
	});
};

Controllers.help = async function (req, res, next) {
	const { help } = await meta.settings.get('pr');
	if (!help) {
		return next();
	}
	const helpPost = await plugins.hooks.fire('filter:parse.post', {
		postData: {
			content: help,
		},
	});
	res.render('pr_system_page', {
		page: helpPost.postData.content,
	});
};


module.exports = Controllers;
