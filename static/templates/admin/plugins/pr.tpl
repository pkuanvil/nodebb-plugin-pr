<form role="form" class="pr-settings">
	<div class="row mb-4">
		<div class="col-sm-2 col-12 settings-header">PR Register Request Settings</div>
		<div class="col-sm-10 col-12">
			<div class="mb-3">
				<label class="form-label" for="register_sk">PR Secret Key</label>
				<input type="text" id="register_sk" name="register_sk" title="PR Secret Key" class="form-control" placeholder="&lt;Base64 encoded private key&gt;">
			</div>
			<div class="mb-3">
				<label class="form-label" for="register_token">PR Register Token</label>
				<input type="text" id="register_token" name="register_token" title="PR Register Token" class="form-control" placeholder="thisistopsecretneverleakthisoranyonecansendregiseremail">
			</div>
			<div class="mb-3">
				<label class="form-label" for="register_email">PR Register Email</label>
				<input type="text" id="register_email" name="register_email" title="PR Register Email" class="form-control" placeholder="xxxxxx@email.com">
			</div>
			<div class="mb-3">
				<label class="form-label" for="register_helo_domains">PR Register HELO Domains</label>
				<input type="text" id="register_helo_domains" name="register_helo_domains" title="PR Register Domains" class="form-control" placeholder="domain1.com;sub1.domain2.com">
			</div>
			<div class="mb-3">
				<label class="form-label" for="default_block_tags">Default block tags</label>
				<input type="text" id="default_block_tags" name="default_block_tags" title="Default block tags" class="form-control" placeholder="">
			</div>
		</div>
	</div>
	<div class="row mb-4">
		<div class="col-sm-2 col-12 settings-header">System Pages</div>
		<div class="col-sm-10 col-12">
			<div class="mb-3">
				<label class="form-label" for="help">help</label>
				<textarea id="help" class="form-control" name="help"></textarea>
			</div>
		</div>
	</div>
	<div class="row mb-4">
		<div class="col-sm-2 col-12 settings-header">General</div>
		<div class="col-sm-10 col-12">
			<div class="mb-3">
				<label class="form-label" for="notification_max_length">Notification Max Length</label>
				<input type="text" id="notification_max_length" name="notification_max_length" title="Notification Max Length" class="form-control" placeholder="140">
			</div>
			<p class="lead">
				Adjust these settings. You can then retrieve these settings in code via:
				<code>meta.settings.get('pr', function(err, settings) {...});</code>
			</p>
			<div class="mb-3">
				<label class="form-label" for="setting1">Setting 1</label>
				<input type="text" id="setting1" name="setting1" title="Setting 1" class="form-control" placeholder="Setting 1">
			</div>
			<div class="mb-3">
				<label class="form-label" for="setting2">Setting 2</label>
				<input type="text" id="setting2" name="setting2" title="Setting 2" class="form-control" placeholder="Setting 2">
			</div>

			<div class="form-check">
				<input type="checkbox" class="form-check-input" id="setting3" name="setting3">
				<label for="setting3" class="form-check-label">Setting 3</label>
			</div>
		</div>
	</div>

	<div class="row mb-4">
		<div class="col-sm-2 col-12 settings-header">Colors</div>
		<div class="col-sm-10 col-12">
			<p class="alert" id="preview">
				Here is some preview text. Use the inputs below to modify this alert's appearance.
			</p>
			<div class="mb-3">
				<label class="form-label" for="color">Foreground</label>
				<input data-settings="colorpicker" type="color" id="color" name="color" title="Background Color" class="form-control" placeholder="#ffffff" value="#ffffff" />
			</div>
			<div class="mb-3">
				<label class="form-label" for="bgColor">Background</label>
				<input data-settings="colorpicker" type="color" id="bgColor" name="bgColor" title="Background Color" class="form-control" placeholder="#000000" value="#000000" />
			</div>
		</div>
	</div>

	<div class="row mb-4">
		<div class="col-sm-2 col-12 settings-header">Sorted List</div>
		<div class="col-sm-10 col-12">
			<div class="mb-3" data-type="sorted-list" data-sorted-list="sample-list" data-item-template="admin/plugins/pr/partials/sorted-list/item" data-form-template="admin/plugins/pr/partials/sorted-list/form">
				<ul data-type="list" class="list-group mb-2"></ul>
				<button type="button" data-type="add" class="btn btn-info">Add Item</button>
			</div>
		</div>
	</div>

	<div class="row">
		<div class="col-sm-2 col-12 settings-header">Uploads</div>
		<div class="col-sm-10 col-12">
			<label class="form-label" for="uploadedImage">Upload Image</label>
			<div class="input-group">
				<input id="uploadedImage" name="uploadedImage" type="text" class="form-control" />
				<input value="Upload" data-action="upload" data-target="uploadedImage" type="button" class="btn btn-default" />
			</div>
		</div>
	</div>
</form>

<!-- IMPORT admin/partials/save_button.tpl -->