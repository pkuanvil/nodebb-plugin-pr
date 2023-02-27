'use strict';

/*
	This file is located in the "modules" block of plugin.json
	It is only loaded when the user navigates to /quickstart page
	It is not bundled into the min file that is served on the first load of the page.
*/

define('forum/pr_dkim_upload', [
	'translator', 'benchpress', 'utils',
], function (translator, Benchpress, utils) {
	const pr_dkim_upload = {};
	pr_dkim_upload.init = function () {
		const submit = $('#upload-submit');
		const errorEl = $('#upload-error-notify');
		const wrapperEl = $('#ajax-toarray');
		$('#content #noscript').val('false');
		submit.on('click', function (e) {
			e.preventDefault();
			errorEl.addClass('hidden');
			wrapperEl.empty();
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
				error: async function (data) {
					const status = data.responseJSON.status;
					const message = status.message || data.responseText;
					let toArray = (data.responseJSON.response && data.responseJSON.response.toArray) || [];
					toArray = toArray.map((toObject) => {
						toObject.toEscaped = utils.escapeHTML(toObject.to);
						delete toObject.to;
						return toObject;
					});
					try {
						const [messageTranslated, htmlTranslated] = await Promise.all([
							translator.translate(message, config.defaultLang),
							Benchpress.render('partials/dkim/toarray', {
								toArray,
							}).then(html => translator.translate(html, config.defaultLang)),
						]);
						errorEl.find('p').text(messageTranslated);
						errorEl.removeClass('hidden');
						wrapperEl.html(htmlTranslated);
						// Directly show <table> instead of embedding in <details>
						const table = wrapperEl.find('table');
						table.detach();
						wrapperEl.empty();
						wrapperEl.append(table);
					} catch (e) {
						console.error(e);
						console.trace();
					}
				},
			});
		});
	};
	return pr_dkim_upload;
});
