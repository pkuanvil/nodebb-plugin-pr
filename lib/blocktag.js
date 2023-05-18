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
	if (typeof data[pr_blockTags] !== 'string') {
		return payload;
	}
	// A single comman means disable default filter tags
	if (data[pr_blockTags] === ',') {
		settings[pr_blockTags] = ',';
	} else {
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
 *  We want to make this function synchronous for the sake of _.filter()
 */
blockTag.hasBlockedTags = function (data, callerUserSettings, defaultBlockTags) {
	if (!data.tags) {
		return false;
	}
	/* data.tags: [{
		value,
		valueEscaped,
		valueEncoded,
		class
	}] */
	const tagList = data.tags.map(tagData => tagData.value.toLowerCase());
	let blockTags;
	if (!callerUserSettings[pr_blockTags]) {
		blockTags = defaultBlockTags;
	} else {
		blockTags = callerUserSettings[pr_blockTags].toLowerCase().split(',');
	}
	return _.intersection(tagList, blockTags).length !== 0;
};

blockTag.getDefaultTags = async function () {
	const { default_block_tags } = await meta.settings.get('pr');
	if (!default_block_tags) {
		return [];
	}
	return default_block_tags.split(',').map(tag => tag.toLowerCase());
};

blockTag.pr_userGlobalDefaults = async function (payload) {
	const { default_block_tags } = await meta.settings.get('pr');
	// defaultBlockTagsStr use original case as set in ACP. This is for display purposes
	payload.defaultBlockTagsStr = default_block_tags || '';
	payload.defaultBlockTags = payload.defaultBlockTagsStr.toLowerCase().split(',');
};

module.exports = blockTag;
