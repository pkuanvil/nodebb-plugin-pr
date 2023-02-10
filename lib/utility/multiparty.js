'use strict';

const file = require.main.require('./src/file');

const MultiParty = {};

/** Tempfile delete don't need to be awaited, because temp files are guranteed to have unique file names
 *  and thus don't cause races. However, if you are paranoid about cleanup you may also await those.
 */

MultiParty.deleteTempFile = function (multiPartyFile) {
	return file.delete(multiPartyFile.path);
};

MultiParty.deleteTempFileArray = function (multiPartyFileArray) {
	return multiPartyFileArray.forEach(multiPartyFile => file.delete(multiPartyFile.path));
};

module.exports = MultiParty;
