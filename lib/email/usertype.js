'use strict';

const { emailGetDomain } = require('./utility');

const EmailUserType = {};

// The key must be a number, because it's used as the `score` in sortedSetAdd()
// 'from' address must not have duplicates
EmailUserType.types = new Map([
	[1, { name: 'PKU', from: ['pku.edu.cn', 'bjmu.edu.cn', 'pku.org.cn'] }],
	[2, { name: 'THU', from: ['tsinghua.edu.cn', 'tsinghua.org.cn'] }],
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

function getParentDomains(domain) {
	let index = 0;
	const result = [];
	while (true) {
		index = domain.indexOf('.', index);
		if (index === -1) {
			break;
		}
		result.push(domain.substring(index + 1));
		index += 1;
	}
	return result;
}

EmailUserType.getType = function (from) {
	let domain;
	if (from.indexOf('@') === -1) {
		domain = from;
	} else {
		domain = emailGetDomain(from);
	}
	let result = mail2TypeName.get(domain);
	if (result) {
		return result;
	}
	// Check whether this is a subdomain
	const parentDomains = getParentDomains(domain);
	for (const parent of parentDomains) {
		result = mail2TypeName.get(parent);
		if (result) {
			return result;
		}
	}
	// Failure here
	return result;
};

module.exports = EmailUserType;
