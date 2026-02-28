docker run --name ai-pgvector \
  -e POSTGRES_USER=postgres \
  -e POSTGRES_PASSWORD=123 \
  -e POSTGRES_DB=ai-pg-vector \
  -p 5432:5432 \
  --restart always \
  pgvector/pgvector:pg16
