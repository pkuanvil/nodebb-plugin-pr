'use strict';

const _ = require.main.require('lodash');

const Privacy = {};

Privacy.removeJoinDateFromArray = function (array) {
	_.remove(array, value => value === 'joindate');
};

Privacy.isFutureTopicorPost = function (data, callerUid) {
	return data.timestamp && data.timestamp > Date.now() && parseInt(callerUid, 10) !== data.uid;
};

Privacy.dataFields = ['timestamp'];

module.exports = Privacy;
