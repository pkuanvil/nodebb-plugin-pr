'use strict';

const { emailGetDomain } = require('./utility');

const EmailUserType = {};

// The key must be a number, because it's used as the `score` in sortedSetAdd()
// 'from' address must not have duplicates
EmailUserType.types = new Map([
	[1, { name: 'PKU', from: ['pku.edu.cn', 'stu.pku.edu.cn', 'pku.org.cn', 'alumni.pku.edu.cn'] }],
	[2, { name: 'THU', from: ['mails.tsinghua.edu.cn', 'tsinghua.edu.cn', 'sz.tsinghua.edu.cn', 'tsinghua.org.cn'] }],
]);

function setMailToTypeMap(types) {
	const result = new Map();
	types.forEach((value, key) => {
		const { from } = value;
		from.forEach((domain) => {
			result.set(domain, key);
		});
	});
	return result;
}

const mail2TypeName = setMailToTypeMap(EmailUserType.types);

EmailUserType.getType = function (from) {
	let domain;
	if (from.indexOf('@') === -1) {
		domain = from;
	} else {
		domain = emailGetDomain(from);
	}
	return mail2TypeName.get(domain);
};

module.exports = EmailUserType;
