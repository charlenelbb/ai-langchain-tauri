variable "region" {
  description = "部署地域。默认香港，公网 80 端口不需要 ICP 备案。大陆地域的网站需要备案。"
  type        = string
  default     = "cn-hongkong"
}

variable "project_name" {
  description = "资源名前缀。"
  type        = string
  default     = "ai-langchain"

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{1,24}$", var.project_name))
    error_message = "project_name 需为小写字母开头，只含小写字母、数字和连字符，最长 25 个字符。"
  }
}

variable "instance_type" {
  description = "ECS 规格。香港若没有该规格，改成控制台能买到的 2 核 4 GB 规格。"
  type        = string
  default     = "ecs.e-c1m2.large"
}

variable "ssh_cidr" {
  description = "允许 SSH 的来源网段。知道自己的公网 IP 时改成该 IP/32。"
  type        = string
  default     = "0.0.0.0/0"
}
