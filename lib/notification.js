'use strict';

const { catchApiException } = require('./utility/controllerhelper');

const controllerHelpers = require.main.require('./src/controllers/helpers');
const NodeBBNotifications = require.main.require('./src/notifications');
const NodeBBGroups = require.main.require('./src/groups');

const Notification = {};

Notification.Push = catchApiException(async (req, res) => {
	const { data } = req.body;
	let { uids } = req.body;
	const notifyObj = await NodeBBNotifications.create(data);
	// uids can be a string (group name) or array of uids
	if (!uids) {
		uids = 'registered-users';
	}
	if (typeof uids === 'string') {
		uids = await NodeBBGroups.getMembers(uids, 0, -1);
	}
	await NodeBBNotifications.push(notifyObj, uids);
	return controllerHelpers.formatApiResponse(200, res, { data: notifyObj, uids });
});

module.exports = Notification;
