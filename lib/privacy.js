'use strict';

const _ = require.main.require('lodash');
const sanitizeHTML = require.main.require('sanitize-html');
const user = require.main.require('./src/user');

const Privacy = {};
Privacy.pr_showOnlineTime = 'pr_showOnlineTime';

Privacy.hideUserArrayFields = async function (userArray) {
	for (const userData of userArray) {
		// joindate hide is mandatory
		delete userData.joindate;
	}
	const settingsArray = await user.getMultipleUserSettings(userArray.map(userData => userData.uid));
	for (let i = 0; i < userArray.length; i++) {
		const settings = settingsArray[i];
		const userData = userArray[i];
		if (!settings[Privacy.pr_showOnlineTime]) {
			delete userData.lastonline;
		}
	}
};

Privacy.userSaveSettings = function (payload) {
	const { settings, data } = payload;
	if (typeof data[Privacy.pr_showOnlineTime] === 'number') {
		settings[Privacy.pr_showOnlineTime] = data[Privacy.pr_showOnlineTime];
	}
	return payload;
};

Privacy.isFutureTopicorPost = function (data, callerUid) {
	return data.timestamp && data.timestamp > Date.now() && parseInt(callerUid, 10) !== data.uid;
};

const CORSTags = ['img', 'audio', 'video'];

// Allow 'crossorigin' attributes for media HTML tags
Privacy.sanitizeHTML = function (config) {
	config.globalAttributes = _.union(config.globalAttributes, ['crossorigin']);
	for (const tag of CORSTags) {
		config.allowedAttributes[tag] = _.union(config.allowedAttributes[tag], ['crossorigin']);
	}
	return config;
};

/**
 * Enforce 'anonoymous' CORS mode for media HTML Tags. Currently (2023/01/31) browsers already isolate 3rd-party cookies
 * by default, but enabling CORS is an additional security measure.
 *
 * Test example: disable privacy protection (like Firefox's 'Tracking Protection') in browsers, and find a website that
 * have cookies set with `SameSite=None` (example: https://unsplash.com). Non-CORS mode will sent cookies,
 * while CORS mode don't.
 */
Privacy.pr_sanitizeHTML = function (options) {
	if (typeof options.transformTags !== 'object') {
		options.transformTags = {};
	}
	for (const tag of CORSTags) {
		options.transformTags[tag] = sanitizeHTML.simpleTransform(tag, { crossorigin: 'anonymous' }, true);
	}
	return options;
};

Privacy.dataFields = ['timestamp'];

module.exports = Privacy;
