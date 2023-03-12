'use strict';

const posts = require.main.require('./src/posts');
const utils = require.main.require('./src/utils');

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

Excerpt.setTopicsExcerpt = async function (topics) {
	// Modified from src/topics/teaser.js without hook, user block and metadata. Just the content
	if (!Array.isArray(topics) || !topics.length) {
		return [];
	}

	const teaserPids = [];
	const tidToPost = {};

	topics.forEach(topic => topic && teaserPids.push(topic.mainPid));

	const allPostData = await posts.getPostsFields(teaserPids, ['pid', 'tid', 'content']);
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
	teasers.forEach((teaser) => {
		if (teaser && teaser.content) {
			teaser.content = truncString(teaser.content, 140);
		}
	});
};

module.exports = Excerpt;
