-- RDS 不会执行 docker/init。LangChain 使用 <=> 之前必须先有 vector 扩展。
CREATE EXTENSION IF NOT EXISTS vector;
