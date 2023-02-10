'use strict';

const chalk = require.main.require('chalk');
const controllerHelpers = require.main.require('./src/controllers/helpers');

const ControllerHelpers = {};

// Modified from src/controllers/helpers.js::formatApiResponse
ControllerHelpers.errorWithResponse = async function (statusCode, res, payload, response) {
	let message;
	if (payload instanceof Error) {
		message = payload.message;
	} else if (typeof payload === 'string') {
		message = payload;
	}
	response = response || {};
	if (message.startsWith('[[error:required-parameters-missing, ')) {
		const params = message.slice('[[error:required-parameters-missing, '.length, -2).split(' ');
		Object.assign(response, { params });
	}
	const returnPayload = await controllerHelpers.generateError(statusCode, message, res);
	returnPayload.response = response;
	if (payload instanceof Error && global.env === 'development') {
		returnPayload.stack = payload.stack;
		process.stdout.write(`[${chalk.yellow('api')}] Exception caught, error with stack trace follows:\n`);
		process.stdout.write(payload.stack);
	}
	res.status(statusCode).json(returnPayload);
};

module.exports = ControllerHelpers;
