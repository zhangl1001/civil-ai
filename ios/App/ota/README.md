# OTA Signing Material

OTA signing private keys and certificates must not be stored in this repository.

- Keep private keys in CI secrets or an access-controlled local directory.
- Inject signing paths through the release environment.
- Treat the former repository key and matching certificate as compromised and revoke them before another OTA release.
- Do not restore `key.pem` or `cert.pem` under this directory.
