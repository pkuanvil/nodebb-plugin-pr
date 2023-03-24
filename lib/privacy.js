'use strict';

const _ = require.main.require('lodash');
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

Privacy.pr_sanitizeHTML = function (options) {
	if (typeof options.transformTags !== 'object') {
		options.transformTags = {};
	}
	return options;
};

Privacy.dataFields = ['timestamp'];

module.exports = Privacy;
