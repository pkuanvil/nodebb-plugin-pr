'use strict';

const chalk = require.main.require('chalk');
const controllerHelpers = require.main.require('./src/controllers/helpers');
const { escapeHTML } = require.main.require('./src/utils');

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

ControllerHelpers.toArrayEscapeHTML = function (toArray) {
	// Do a deep copy because db.getObject() returns the same object in case of cache
	// Note: simple ES6 Object destruct like `toArray = [...dkimStatus.toArray]` won't work,
	// because toArray elements are also objects
	const toArrayEscaped = structuredClone(toArray);
	// "to" can be a full email address and thus may contain weird HTMl characters
	// like '=?utf-8?xxxxx?= <email@example.com>'
	for (const toObject of toArrayEscaped) {
		toObject.toEscaped = escapeHTML(toObject.to);
		delete toObject.to;
	}
	return toArrayEscaped;
};

ControllerHelpers.catchApiException = middleware => async function (req, res, next) {
	try {
		return await middleware(req, res, next);
	} catch (e) {
		console.error(e.stack);
		return controllerHelpers.formatApiResponse(500, res, Error('Internal Server Error'));
	}
};

module.exports = ControllerHelpers;
