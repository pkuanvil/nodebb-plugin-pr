# @pkuanvil/nodebb-plugin-pr

This is a NodeBB plugin private to PKU Anvil: https://www.pkuanvil.com. Current functionalities:

* Email Register
  - Register request (the encrypted message is simplely a RSA public key encrytion of username and password)
  - DKIM (Verify an email which has DKIM "To:" signature)
* hcaptcha (not yet enabled at PKU Anvil, although the code is prepared)
* Privacy:
  - Don't show register time
  - Allow user to hide online time in user settings
* Block Tag: user can filter topics with specific tag
