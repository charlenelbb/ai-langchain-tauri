output "public_ip" {
  value = alicloud_instance.main.public_ip
}

output "site_url" {
  value = "http://${alicloud_instance.main.public_ip}"
}

output "ssh_command" {
  value = "ssh -i infra/.ssh-key root@${alicloud_instance.main.public_ip}"
}

output "private_key" {
  value     = tls_private_key.ssh.private_key_openssh
  sensitive = true
}
