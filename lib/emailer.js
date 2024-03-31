'use strict';

const { catchApiException } = require('./utility/controllerhelper');

const NodeBBemailer = require.main.require('./src/meta');
const controllerHelpers = require.main.require('./src/controllers/helpers');

const emailer = {};

emailer.sendToEmail = async function (template, email, language, params) {
	await NodeBBemailer.sendToEmail(template, email, language, params);
};

async function send_api(req, res) {
	const payload = req.body;
	const { template, email, language, params } = payload;
	await emailer.send(template, email, language, params);
	controllerHelpers.formatApiResponse(200, res, { template, email, language, params });
}

emailer.send_api = catchApiException(send_api);

module.exports = emailer;
