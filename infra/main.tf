data "alicloud_zones" "available" {
  available_resource_creation = "VSwitch"
  available_instance_type     = var.instance_type
  available_disk_category     = "cloud_essd"
}

data "alicloud_images" "ubuntu" {
  owners      = "system"
  name_regex  = "^ubuntu_22_04_x64_20G"
  most_recent = true
}

resource "alicloud_vpc" "main" {
  vpc_name   = var.project_name
  cidr_block = "10.20.0.0/16"
}

resource "alicloud_vswitch" "main" {
  vswitch_name = var.project_name
  vpc_id       = alicloud_vpc.main.id
  cidr_block   = "10.20.1.0/24"
  zone_id      = data.alicloud_zones.available.zones[0].id
}

resource "alicloud_security_group" "main" {
  security_group_name = var.project_name
  vpc_id              = alicloud_vpc.main.id
  description         = "HTTP and SSH only. Postgres and the API stay on the private docker network."
}

resource "alicloud_security_group_rule" "http" {
  security_group_id = alicloud_security_group.main.id
  type              = "ingress"
  ip_protocol       = "tcp"
  port_range        = "80/80"
  cidr_ip           = "0.0.0.0/0"
  description       = "Web and API through nginx"
}

resource "alicloud_security_group_rule" "egress" {
  security_group_id = alicloud_security_group.main.id
  type              = "egress"
  ip_protocol       = "all"
  port_range        = "-1/-1"
  cidr_ip           = "0.0.0.0/0"
  description       = "Pull images and call DashScope"
}

resource "alicloud_security_group_rule" "ssh" {
  security_group_id = alicloud_security_group.main.id
  type              = "ingress"
  ip_protocol       = "tcp"
  port_range        = "22/22"
  cidr_ip           = var.ssh_cidr
  description       = "SSH for publishing the app"
}

resource "tls_private_key" "ssh" {
  algorithm = "RSA"
  rsa_bits  = 4096
}

resource "alicloud_ecs_key_pair" "main" {
  key_pair_name = var.project_name
  public_key    = tls_private_key.ssh.public_key_openssh
}

resource "alicloud_instance" "main" {
  instance_name                 = var.project_name
  instance_type                 = var.instance_type
  image_id                      = data.alicloud_images.ubuntu.images[0].id
  security_groups               = [alicloud_security_group.main.id]
  vswitch_id                    = alicloud_vswitch.main.id
  system_disk_category          = "cloud_essd"
  system_disk_performance_level = "PL0"
  system_disk_size              = 40
  internet_charge_type          = "PayByTraffic"
  internet_max_bandwidth_out    = 10
  instance_charge_type          = "PostPaid"
  key_name                      = alicloud_ecs_key_pair.main.key_pair_name
  user_data                     = base64encode(file("${path.module}/stack/cloud-init.yaml"))

  # 镜像 ID 会随 most_recent 变化。忽略后续变化，避免换镜像时把磁盘上的数据库删掉。
  lifecycle {
    ignore_changes = [image_id]
  }
}
