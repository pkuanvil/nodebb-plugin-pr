'use strict';

const _ = require.main.require('lodash');

const utils = require.main.require('./src/utils');
const meta = require.main.require('./src/meta');

const blockTag = {};

blockTag.pr_blockTags = 'pr_blockTags';
const { pr_blockTags } = blockTag;

blockTag.dataFields = ['tags'];

blockTag.userSaveSettings = function (payload) {
	const { settings, data } = payload;
	if (typeof data[pr_blockTags] === 'string') {
		// Copied from src/topics/tags.js::filterTags(), but don't fire the hook
		const tagList = data[pr_blockTags].split(',')
			.map(tag => utils.cleanUpTag(tag, meta.config.maximumTagLength))
			.filter(tag => tag && tag.length >= (meta.config.minimumTagLength || 3));

		settings[pr_blockTags] = tagList.join(',');
	}
	return payload;
};

// Currently no hook for user.getSettings() and we rely on NodeBB to don't filter user.getSettings()

/** Returns true for topic that has user blocked tag, false that don't.
 *  This don't have a post version, since only topics have tags.
 */
blockTag.hasBlockedTags = function (data, callerUserSettings) {
	if (!data.tags || !callerUserSettings[pr_blockTags]) {
		return false;
	}
	/* data.tags: [{
		value,
		valueEscaped,
		valueEncoded,
		class
	}] */
	const tagList = data.tags.map(tagData => tagData.value.toLowerCase());
	const callerTagList = callerUserSettings[pr_blockTags].toLowerCase().split(',');
	return _.intersection(tagList, callerTagList).length !== 0;
};

module.exports = blockTag;
