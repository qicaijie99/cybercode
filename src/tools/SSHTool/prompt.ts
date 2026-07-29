export const SSH_TOOL_NAME = 'SSH'

export const SSH_TOOL_DESCRIPTION = `Execute commands on a remote server via SSH.

Usage:
- Provide the host, username, and command to execute remotely.
- Supports key-based and password-based authentication.
- Specify a custom port if the SSH server is not on the default port 22.
- Use identityFile to specify a private key path for key-based auth.

Examples:
- Run "ls -la" on a remote server: { host: "192.168.1.100", username: "user", command: "ls -la" }
- Run with custom port: { host: "example.com", username: "deploy", port: 2222, command: "systemctl status nginx" }
- Run with identity file: { host: "10.0.0.1", username: "admin", identityFile: "~/.ssh/id_rsa", command: "df -h" }`

export function getSSHPrompt(): string {
  return SSH_TOOL_DESCRIPTION
}
