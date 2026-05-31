# `protocol/` — backend-owned protocol helpers

The app no longer owns the Android TV pairing/remote wire codecs here.
`@librecontrol/google-tv` is the source of truth for that behavior.

What remains in this folder is the certificate helper that we still own
locally because persisted client cert generation/storage is application state,
not library protocol logic.
