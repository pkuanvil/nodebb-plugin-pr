'use strict';

const posts = require.main.require('./src/posts');
const utils = require.main.require('./src/utils');
const user = require.main.require('./src/user');

const Excerpt = {};

function replaceImgWithAltText(str) {
	return String(str).replace(/<img .*?alt="(.*?)"[^>]*>/gi, '$1');
}

function truncString(str, length) {
	let result = str;
	if (str.length > length) {
		result = `${str.slice(0, length)}...`;
	}
	return result;
}

Excerpt.setTopicsExcerpt = async function ({ topics, uid }) {
	// Modified from src/topics/teaser.js without hook, user block and metadata. Just the content
	if (!Array.isArray(topics) || !topics.length) {
		return [];
	}

	const teaserPids = [];
	const tidToPost = {};

	topics.forEach(topic => topic && teaserPids.push(topic.mainPid));

	const [allPostData, callerSettings] = await Promise.all([
		posts.getPostsFields(teaserPids, ['pid', 'tid', 'content']),
		user.getSettings(uid),
	]);
	if (!callerSettings.pr_useExcerpt) {
		return;
	}
	const postData = allPostData.filter(post => post && post.pid);

	postData.forEach((post) => {
		tidToPost[post.tid] = post;
	});
	await Promise.all(postData.map(p => posts.parsePost(p)));

	topics.forEach((topic) => {
		if (!topic) {
			return null;
		}
		let excerpt = '';
		if (tidToPost[topic.tid]) {
			if (tidToPost[topic.tid].content) {
				excerpt = utils.stripHTMLTags(replaceImgWithAltText(tidToPost[topic.tid].content));
			}
		}
		topic.excerpt = truncString(excerpt, 255);
	});
};

Excerpt.truncTeasers = async function (teasers) {
	// NodeBB defaults to allow HTML in teasers.
	// If we are to truncate this, we must not directly truncate raw string, since it leads to invalid HTML.
	// This depends on filter:teasers.configureStripTags to strip ALL HTML
	teasers.forEach((teaser) => {
		if (teaser && teaser.content) {
			teaser.content = truncString(teaser.content, 140);
		}
	});
};

Excerpt.userSaveSettings = function (payload) {
	const { settings, data } = payload;
	if (data.pr_useExcerpt) {
		settings.pr_useExcerpt = 1;
	}
	return payload;
};

module.exports = Excerpt;
