<script src="https://js.hcaptcha.com/1/api.js" async defer></script>
<form action="" method="POST">
        <div class="alert alert-danger" id="login-error-notify" <!-- IF error -->style="display:block"<!-- ELSE -->style="display: none;"<!-- ENDIF error -->>
                <p>{error}</p>
        </div>
        <div class="h-captcha" data-sitekey="{sitekey}"></div>
        <br />
        <input type="submit" value="Submit" />
</form>
