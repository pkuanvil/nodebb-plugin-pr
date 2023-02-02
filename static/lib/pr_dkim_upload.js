'use strict';

/*
	This file is located in the "modules" block of plugin.json
	It is only loaded when the user navigates to /quickstart page
	It is not bundled into the min file that is served on the first load of the page.
*/

define('forum/pr_dkim_upload', [
	'translator',
], function (translator) {
	const pr_dkim_upload = {};
	pr_dkim_upload.init = function () {
		const submit = $('#upload-submit');
		const errorEl = $('#upload-error-notify');
		$('#content #noscript').val('false');
		submit.on('click', function (e) {
			e.preventDefault();
			errorEl.addClass('hidden');
			submit.parents('form').ajaxSubmit({
				dataType: 'json',
				success: function (data) {
					if (!data) {
						return;
					}
					if (data.next) {
						window.location.href = data.next;
					}
				},
				error: function (data) {
					const status = data.responseJSON.status;
					const message = status.message || data.responseText;
					translator.translate(message, config.defaultLang, function (translated) {
						errorEl.find('p').text(translated);
						errorEl.removeClass('hidden');
					});
				},
			});
		});
	};
	return pr_dkim_upload;
});
