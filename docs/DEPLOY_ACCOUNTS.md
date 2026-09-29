# Account deployment guide moved

Hosted accounts now use Firebase Spark with private D1 profile/session data.
Follow [the managed-authentication guide](../scripts/cloud-auth/README.md) for
secret configuration, legacy standard-scrypt migration, recovery, and interrupted
security operations, and [CLOUD_RELEASE.md](CLOUD_RELEASE.md) for deployment.

The existing Node/SQLite account backend is preserved for local use. Never include
its private database, recovery hashes, tokens, or password hashes in catalogue
exports or source archives. Old patch-installation instructions remain in Git
history and must not be applied to this integrated branch.
