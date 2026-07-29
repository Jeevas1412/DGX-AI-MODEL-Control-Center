# Security policy

Do not open a public issue containing credentials, private keys, access tokens, internal IP addresses, host names, customer data or DGX deployment details.

After the GitHub repository is created, maintainers must enable GitHub Private Vulnerability Reporting and publish the repository's Security Advisory reporting link. Until that setting is enabled, security findings should be retained in the project's private operating record and handled without sharing sensitive reproduction material publicly.

## Security boundaries

- The renderer must not receive SSH credentials, bearer tokens, Node APIs or arbitrary command execution.
- Remote control must be disabled unless a supported adapter, selected verified profile and explicit local authorization are present.
- Public contributions must pass the public-tree scan before entering Git history.
