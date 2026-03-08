FROM python:3.11-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY server/ ./server/

ENV EXPLORER_DB_PATH=/data/identity_tree_complete.db
ENV PORT=8060

EXPOSE 8060

CMD ["uvicorn", "server.app:app", "--host", "0.0.0.0", "--port", "8060"]
