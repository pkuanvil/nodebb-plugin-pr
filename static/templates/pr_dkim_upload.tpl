<div class="alert alert-danger<!-- IF !error --> hidden<!-- ENDIF !error -->" id="upload-error-notify" >
  <p>{error}</p>
</div>
<form method="post" enctype="multipart/form-data">
  <div>
    <label for="file">[[pr:upload.file]]</label>
    <input type="file" id="file" name="file" multiple="">
  </div>
  <div>
    <button id="upload-submit">[[pr:upload.submit]]</button>
  </div>
</form>