'use strict';

const { string_remove_starts_with } = require('../utility/misc');

const EmailUtility = {};

EmailUtility.emailGetRaw = function (emailfull) {
	const atPosition = emailfull.indexOf('@');
	const lessPosition = emailfull.lastIndexOf('<', atPosition - 1);
	if (lessPosition === -1) {
		return emailfull;
	}
	const largePosition = emailfull.indexOf('>', atPosition + 1);
	return emailfull.substring(lessPosition + 1, largePosition);
};

EmailUtility.emailGetDomain = function (emailfull) {
	const emailRaw = EmailUtility.emailGetRaw(emailfull);
	return string_remove_starts_with(emailRaw, '@');
};

module.exports = EmailUtility;
